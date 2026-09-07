# 04-selezione-dello-scenario-del-primo-anno

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.2

------------------------------------------------------------------------

# Scopo

Definire:

-   struttura temporale della simulazione;
-   frequenza delle elaborazioni;
-   trasformazione delle principali grandezze annuali;
-   selezione dello scenario del primo mese;
-   principi generali dell'intensità macro.

Le transizioni successive al primo mese sono definite nel capitolo 05.

------------------------------------------------------------------------

# Orizzonte temporale

-   La durata della simulazione è un parametro di input scelto
    dall'utente.
-   Il numero di simulazioni è un parametro di input proveniente dal
    frontend.
-   L'output può essere aggregato e mostrato su base annuale.
-   Tutte le elaborazioni interne del motore avvengono su base mensile.

Se l'utente sceglie `N` anni:

`numeroMesi = N * 12`

------------------------------------------------------------------------

# Passo temporale

L'unità fondamentale del motore è il mese.

Ogni mese può avere:

-   scenario differente;
-   intensità differente;
-   expected return mensile differente;
-   volatilità mensile differente;
-   matrice di correlazione determinata dallo scenario corrente.

Lo scenario non rimane obbligatoriamente fisso per un anno.

------------------------------------------------------------------------

# Grandezze annuali e mensili

Il database conserva le statistiche finanziarie nella loro semantica
annuale.

Prima/durante la simulazione il servizio costruisce i parametri mensili
necessari.

## Expected return

Decisione definitiva:

`monthlyExpectedReturn = (1 + annualExpectedReturn)^(1/12) - 1`

Non utilizzare:

`annualExpectedReturn / 12`

La conversione composta garantisce coerenza geometrica tra frequenza
annuale e mensile.

------------------------------------------------------------------------

## Volatilità

Decisione definitiva:

`monthlyVolatility = annualVolatility / sqrt(12)`

La volatilità annuale originale resta disponibile come dato sorgente.

------------------------------------------------------------------------

## Max Drawdown

Il `max_drawdown` NON viene mensilizzato.

È una misura di perdita dal picco e non un rendimento periodico.

Il drawdown effettivo del percorso Monte Carlo sarà calcolato sulla
traiettoria del capitale.

------------------------------------------------------------------------

## Correlazioni

Le correlazioni NON vengono mensilizzate.

La correlazione specifica del macro-scenario corrente viene utilizzata
per generare i rendimenti mensili congiunti degli ETF.

------------------------------------------------------------------------

## Long Term Expected Return

Il `long_term_expected_return` rimane annualizzato.

Non viene utilizzato direttamente come expected return del singolo mese.

Rappresenta il benchmark/vincolo di lungo periodo del modello.

La modalità con cui verrà utilizzato per il controllo della convergenza
sarà definita in un capitolo dedicato.

------------------------------------------------------------------------

## Return range

Il `return_range` presente nel database è annuale.

Decisione definitiva:

-   non dividerlo per 12;
-   non applicare direttamente la radice dodicesima agli estremi;
-   derivare successivamente limiti mensili statisticamente coerenti con
    il range annuale e almeno con la volatilità.

La formula esatta sarà definita nel capitolo dedicato alla generazione
dei rendimenti.

------------------------------------------------------------------------

# Selezione dello scenario iniziale

Il primo mese del primo anno di ogni singolo percorso Monte Carlo non ha
uno scenario precedente.

Lo scenario iniziale viene quindi estratto esclusivamente dalla tabella
DB:

`structural_probability`

Il servizio non deve hardcodare le probabilità iniziali.

Procedura:

1.  leggere le quattro probabilità da `structural_probability`;
2.  validarle;
3.  costruire la distribuzione cumulativa;
4.  estrarre un numero casuale uniforme;
5.  selezionare esattamente uno dei quattro scenari;
6.  impostare `monthsInCurrentScenario = 1`.

La `transition_matrix` NON partecipa alla selezione del primo scenario.

------------------------------------------------------------------------

# Primo mese e intensità

Ogni mese è caratterizzato da una sola intensità macro condivisa da
tutti gli ETF.

L'intensità appartiene a:

`[0,1]`

Per ciascuno scenario esiste una configurazione nella tabella:

`scenario_intensity_config`

con almeno:

-   `mean_intensity`;
-   `std_dev_intensity`.

La distribuzione approvata è una:

**Gaussiana troncata specifica per scenario.**

------------------------------------------------------------------------

# Intensità del primo mese della simulazione

Dopo l'estrazione dello scenario iniziale deve essere estratta anche
l'intensità iniziale coerentemente con la distribuzione dello scenario
selezionato.

Poiché il primo mese della simulazione coincide anche con il primo mese
del regime corrente, deve essere applicata la stessa logica di ingresso
prevista per un nuovo scenario.

La property iniziale è:

`new_scenario_first_month_max_intensity = 0.40`

Il valore 0.40 è una **soglia statistica morbida**, non necessariamente
un hard cap.

La distribuzione del primo mese deve essere adattata affinché la grande
maggioranza dei valori ricada entro circa 0.40.

Valori superiori possono essere accettati se appartengono a code
statisticamente poco probabili.

La formula esatta di adattamento della Gaussiana sarà definita nel
capitolo dedicato all'intensità.

------------------------------------------------------------------------

# Evoluzione dal secondo mese

Dal secondo mese in avanti la selezione dello scenario è disciplinata
dal capitolo 05.

Il processo considera congiuntamente:

-   scenario corrente;
-   intensità corrente;
-   soglia di intensità che può bloccare la transizione;
-   fase ENTRY/PERSISTENCE/EXIT;
-   `transition_matrix`;
-   durata del regime;
-   memoria dell'intensità.

Nel secondo mese di un nuovo scenario la soglia statistica morbida
iniziale è:

`new_scenario_second_month_max_intensity = 0.70`

------------------------------------------------------------------------

# Intensità e rendimenti

È approvato che l'intensità influenzi:

-   `expected_return`;
-   `volatility`.

Principio:

-   intensità bassa -\> effetto macro più debole e comportamento più
    vicino alla condizione neutrale;
-   intensità alta -\> scenario espresso più pienamente e volatilità
    coerentemente più elevata.

L'intensità è comune a tutti gli ETF nel mese, mentre la risposta di
ciascun ETF dipenderà dalle statistiche specifiche dello scenario.

La formula quantitativa sarà definita nel capitolo dedicato.

------------------------------------------------------------------------

# Sequenza logica del primo mese

Per ogni percorso Monte Carlo:

1.  leggere e validare `structural_probability`;
2.  estrarre `currentScenario`;
3.  impostare `monthsInCurrentScenario = 1`;
4.  leggere `scenario_intensity_config[currentScenario]`;
5.  estrarre `currentIntensity` dalla Gaussiana troncata adattata alla
    fase di ingresso;
6.  trasformare `expected_return` annuale dello scenario in expected
    return mensile;
7.  trasformare `volatility` annuale in volatilità mensile;
8.  utilizzare le correlazioni dello scenario senza mensilizzarle;
9.  derivare, secondo il capitolo dedicato, i limiti mensili coerenti
    con `return_range`;
10. applicare intensità a expected return e volatilità secondo la
    formula che sarà definita;
11. generare i rendimenti mensili correlati degli ETF;
12. calcolare il rendimento mensile del portafoglio;
13. aggiornare capitale e metriche del percorso.

Dal mese successivo, prima della generazione dei rendimenti, entra in
funzione la logica di transizione del capitolo 05.

------------------------------------------------------------------------

# Ribilanciamento

Durante l'anno il portafoglio non viene ribilanciato nella versione
corrente.

La logica completa del ribilanciamento e della possibile deriva dei pesi
verrà affrontata nel capitolo dedicato.

------------------------------------------------------------------------

# Validazioni

La simulazione non parte se:

-   manca uno dei quattro scenari in `structural_probability`;
-   le probabilità iniziali non sommano a 1 entro tolleranza;
-   manca `scenario_intensity_config` per lo scenario;
-   media o deviazione standard dell'intensità sono invalide;
-   mancano statistiche ETF necessarie;
-   mancano correlazioni necessarie.

Nessun fallback hardcoded.

------------------------------------------------------------------------

# Decisioni approvate

-   Orizzonte temporale scelto dall'utente.
-   Numero di simulazioni proveniente dal frontend.
-   Elaborazione interna mensile.
-   Primo scenario estratto da `structural_probability`.
-   `transition_matrix` esclusa dalla scelta del primo scenario.
-   `expected_return` mensilizzato geometricamente.
-   `volatility` mensilizzata con `sqrt(12)`.
-   `max_drawdown` non mensilizzato.
-   correlazioni non mensilizzate.
-   `long_term_expected_return` annualizzato.
-   `return_range` annuale nel DB con limiti mensili derivati
    statisticamente.
-   Intensità unica mensile condivisa da tutti gli ETF.
-   Intensità tramite Gaussiana troncata specifica per scenario.
-   Primo mese trattato come ingresso nel regime.
-   Soglia 0.40 del primo mese come soglia statistica morbida.
-   Dal secondo mese interviene il capitolo 05.
-   Intensità applicata sia a expected return sia a volatilità.
-   Nessun ribilanciamento implicito legato a scenario o intensità. Il ribilanciamento annuale del portafoglio è definito nel capitolo 19.
