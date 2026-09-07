# 02 - Modello dati e unità di misura

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

## Versione

1.1

------------------------------------------------------------------------

## Scopo

Definire formato, unità di misura, frequenza temporale e validazioni dei
dati utilizzati dal motore Monte Carlo.

------------------------------------------------------------------------

## Convenzione numerica

Tutti i valori percentuali sono memorizzati come numeri decimali.

-   `8% = 0.08`
-   `-25% = -0.25`

La convenzione vale per:

-   `expected_return`
-   `long_term_expected_return`
-   `volatility`
-   `max_drawdown`
-   `return_range.min`
-   `return_range.max`
-   probabilità
-   pesi
-   correlazioni
-   intensità
-   parametri di inerzia

Non sono ammesse interpretazioni miste dello stesso dato.

------------------------------------------------------------------------

## Unità di misura nel database

I dati finanziari di origine restano memorizzati nella loro semantica
annuale:

-   `expected_return`: rendimento annuo decimale;
-   `long_term_expected_return`: CAGR nominale annuo atteso;
-   `volatility`: volatilità annualizzata;
-   `max_drawdown`: drawdown negativo, non una grandezza da dividere per
    il tempo;
-   `return_range.min/max`: range plausibile annuale;
-   correlazioni: coefficienti Pearson adimensionali `[-1,+1]`.

I parametri del motore macro sono invece riferiti al passo mensile
quando previsto:

-   `transition_matrix.probability`: probabilità di transizione mensile;
-   `entry_probability`: probabilità mensile di permanenza autonoma
    durante ENTRY;
-   `persistence_probability`: probabilità mensile di permanenza
    autonoma;
-   `entry_months`: numero di mesi;
-   `exit_start_month`: mese di inizio decadimento;
-   `exit_decay`: decadimento per step mensile;
-   intensità: valore adimensionale `[0,1]`.

------------------------------------------------------------------------

## Conversioni per il motore mensile

Il database conserva i parametri finanziari annuali.

Il servizio crea i parametri mensili necessari alla simulazione senza
sovrascrivere i valori annuali originali.

Regole approvate:

### Expected return

`monthlyExpectedReturn = (1 + annualExpectedReturn)^(1/12) - 1`

### Volatilità

`monthlyVolatility = annualVolatility / sqrt(12)`

### Long Term Expected Return

Rimane annualizzato.

Non viene mensilizzato come parametro di generazione diretta del
rendimento.

### Max Drawdown

Rimane nella propria semantica originale.

Non viene mensilizzato.

### Correlazioni

Non vengono mensilizzate.

La matrice di correlazione dello scenario corrente viene applicata ai
rendimenti mensili generati in quello scenario.

### Return range

Il `return_range` memorizzato nel DB resta annuale.

Non deve essere trasformato con:

-   divisione per 12;
-   radice dodicesima applicata direttamente agli estremi.

I limiti mensili saranno derivati statisticamente nel capitolo dedicato
alla generazione dei rendimenti, coerentemente almeno con:

-   range annuale;
-   volatilità;
-   distribuzione scelta.

La decisione approvata è utilizzare limiti mensili statisticamente
derivati.

------------------------------------------------------------------------

## Pesi

-   intervallo consentito: `[0,1]`;
-   nessun peso negativo;
-   nessuna leva;
-   somma pesi portafoglio = `1` entro tolleranza.

Durante l'anno il portafoglio non viene ribilanciato nella versione
corrente.

La logica definitiva della deriva dei pesi/capitale sarà trattata nel
capitolo dedicato al portafoglio.

------------------------------------------------------------------------

## Probabilità strutturali

La tabella `structural_probability` deve contenere la distribuzione
utilizzata per estrarre lo scenario del primo mese.

Validare:

-   presenza dei quattro macro-scenari;
-   nessun duplicato;
-   probabilità in `[0,1]`;
-   somma = `1` entro tolleranza.

------------------------------------------------------------------------

## Transition matrix

La tabella `transition_matrix` deve contenere 16 combinazioni:

`from_scenario -> to_scenario`

Validare:

-   tutte le 16 righe;
-   nessun duplicato;
-   probabilità in `[0,1]`;
-   somma delle quattro probabilità per ogni `from_scenario` = `1`.

Le probabilità sono mensili.

------------------------------------------------------------------------

## Configurazione inerzia

Per ciascuno dei quattro scenari devono esistere:

-   `entry_probability`
-   `persistence_probability`
-   `entry_months`
-   `exit_start_month`
-   `exit_decay`

Validazioni:

-   `0 <= entry_probability <= 1`
-   `0 <= persistence_probability <= 1`
-   `entry_months >= 1`
-   `exit_start_month > entry_months`
-   `0 <= exit_decay <= 1`

------------------------------------------------------------------------

## Configurazione intensità

La tabella `scenario_intensity_config` deve contenere esattamente una
configurazione per scenario.

Campi minimi:

-   `scenario`
-   `mean_intensity`
-   `std_dev_intensity`

Validazioni:

-   `0 <= mean_intensity <= 1`
-   `std_dev_intensity > 0`

L'intensità generata deve sempre rispettare il dominio fisico `[0,1]`.

------------------------------------------------------------------------

## Property globali macro

Devono essere presenti almeno:

-   `scenario_transition_intensity_threshold`
-   `new_scenario_first_month_max_intensity`
-   `new_scenario_second_month_max_intensity`
-   `scenario_intensity_max_monthly_variation`

Validare i valori percentuali nell'intervallo `[0,1]`.

Le soglie del primo e secondo mese sono soglie statistiche morbide, non
necessariamente hard cap.

------------------------------------------------------------------------

## Correlazioni

Validare:

-   ogni correlazione in `[-1,+1]`;
-   matrice simmetrica;
-   diagonale = `1`;
-   presenza delle coppie necessarie per tutti gli ETF del portafoglio e
    per tutti gli scenari richiesti.

La validità matematica positiva semidefinita della matrice sarà
affrontata nel capitolo dedicato alle correlazioni.

------------------------------------------------------------------------

## Statistiche ETF

Per ogni scenario:

-   `volatility >= 0`
-   `max_drawdown <= 0`
-   `return_range.min <= expected_return <= return_range.max`
-   `return_range.min >= -1`

I dati annuali originali devono restare disponibili anche quando il
servizio costruisce equivalenti mensili.

------------------------------------------------------------------------

## Tolleranza numerica

Usare:

`EPSILON = 1e-9`

per i confronti floating point, salvo eventuali tolleranze statistiche
specifiche definite nei capitoli di test.

------------------------------------------------------------------------

## Dati mancanti e Fail Fast

Il motore deve interrompere la simulazione con errore esplicito se manca
una configurazione obbligatoria o se un dato è invalido.

È vietato:

-   usare fallback hardcoded;
-   inventare valori;
-   normalizzare silenziosamente dati strutturalmente errati;
-   proseguire con configurazioni incomplete.

------------------------------------------------------------------------

## Decisioni approvate

-   Convenzione unica in formato decimale.
-   Database finanziario espresso principalmente su base annuale.
-   Motore interno a passo mensile.
-   Expected return mensilizzato geometricamente.
-   Volatilità mensilizzata con `sqrt(12)`.
-   Long Term Expected Return annualizzato.
-   Max Drawdown non mensilizzato.
-   Correlazioni non mensilizzate.
-   Return range annuale nel DB e limiti mensili derivati
    statisticamente.
-   Transition matrix mensile.
-   Intensità in `[0,1]`.
-   Validazioni centralizzate.
-   Fail fast su dati mancanti o incoerenti.
