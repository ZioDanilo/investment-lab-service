# 21-capitale

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

## 1. Scopo

Definire rappresentazione e conservazione della traiettoria del capitale
per ogni percorso Monte Carlo, senza duplicare le logiche economiche già
definite nei capitoli 18-20.

## 2. Capitale mensile

La traiettoria ufficiale ha granularità mensile.

Per `Y` anni:

`numberOfMonths = Y * 12`

`capital[0 ... numberOfMonths]`

con:

`capital[0] = initialCapital`

La granularità mensile è necessaria anche per il successivo calcolo del
drawdown.

## 3. Capitale reale

Utilizzare direttamente il capitale iniziale reale ricevuto dal
frontend. Non mantenere parallelamente un NAV 100.

## 4. Aggiornamento

Resta valida:

`capital_t+1 = capital_t * (1 + portfolioReturn_t)`

e il capitale aggregato deve coincidere, entro tolleranza, con la somma
dei controvalori delle posizioni.

## 5. Capitale annuale

Il capitale annuale è esclusivamente il valore di fine anno:

`yearEndCapital_y = capital[y * 12]`

Quindi anno 1 = mese 12, anno 2 = mese 24, ecc.

Non utilizzare medie del capitale mensile.

## 6. Momento di rilevazione

Registrare il capitale di fine anno **prima del ribilanciamento**:

``` text
rendimento dicembre
-> aggiornamento capitale
-> registrazione capitale fine anno
-> chiusura dati annuali
-> eventuale ribilanciamento
-> gennaio successivo
```

## 7. Dati minimali

Per la traiettoria conservare concettualmente soltanto:

``` text
simulationId
month
capital
```

Non duplicare qui rendimenti, pesi, scenari, intensità, shock,
correlazioni o altri dati già gestiti altrove.

## 8. Capitale finale

Mantenere esplicitamente per ogni percorso:

`finalCapital = capital[numberOfMonths]`

anche se derivabile dalla traiettoria, perché sarà utilizzato
frequentemente nei KPI successivi.

## 9. Percorsi a zero

Se il capitale arriva a zero, il percorso non viene eliminato e mantiene
tutti i mesi fino alla fine.

Da quel momento:

`capital = 0`

per tutti i periodi successivi.

I valori annuali successivi saranno quindi anch'essi zero e
continueranno a contribuire normalmente alle statistiche.

## 10. Nessun minimo/massimo

Non conservare come output specifici del capitolo 21:

-   `minCapital`;
-   `maxCapital`.

Il running peak e le informazioni necessarie al drawdown saranno
responsabilità del capitolo 22.

## 11. Nessuna nuova Statistics

Non aggiungere nuove statistiche sul capitale nel tempo.

In particolare non introdurre qui: - capitale medio annuale; - capitale
mediano annuale come KPI autonomo; - percentili temporali mensili; - altre distribuzioni non previste. Fa eccezione il ventaglio **annuale** P5/P25/P50/P75/P95 definito nel capitolo 24
patrimoniali.

Restano valide le Statistics già definite.

## 12. Capitale annuale per il grafico

Per il percorso selezionato dal servizio secondo la logica già definita,
restituire al frontend:

``` text
anno 1 -> capitale fine anno 1
anno 2 -> capitale fine anno 2
...
anno Y -> capitale fine anno Y
```

La struttura minima può essere:

``` text
year
yearEndCapital
```

## 13. Derivazione del grafico

Il dato annuale deriva direttamente dalla traiettoria mensile:

`chartAnnualCapital_y = capital[y * 12]`

Non creare: - una seconda simulazione; - una traiettoria annuale
indipendente; - un NAV 100 parallelo.

La traiettoria mensile resta la fonte di verità.

## 14. Precisione

Nessun arrotondamento durante il calcolo o nella traiettoria conservata.
La formattazione monetaria avviene soltanto in output/frontend.

## 15. Valori non validi

Restano condizioni di fail-fast: - `NaN`; - `+Infinity`; -
`-Infinity`; - capitale negativo.

Il capitale esattamente pari a zero è invece un risultato economico
valido.

## 16. Coerenza temporale

Ogni percorso deve contenere esattamente `Y * 12` mesi simulati, anche
se il capitale raggiunge zero prima della fine.

## 17. Confini del capitolo

Il capitolo 21 non calcola: - running peak; - drawdown; - max
drawdown; - durata/recovery del drawdown; - CAGR; - percentili.

Queste responsabilità appartengono ai capitoli successivi.

## 18. Decisioni definitive

-   Capitale mensile come base ufficiale.
-   Traiettoria con capitale iniziale e tutti i mesi simulati.
-   Capitale reale ricevuto dal frontend.
-   Nessun NAV 100 parallelo.
-   Capitale annuale = valore di fine anno.
-   Fine anno = mesi 12, 24, 36, ecc.
-   Capitale annuale rilevato prima del ribilanciamento.
-   Struttura dati minimale.
-   `finalCapital` mantenuto esplicitamente.
-   Percorsi a zero mantenuti fino alla fine e a zero.
-   Nessun minimo/massimo specifico.
-   Nessuna nuova Statistics sul capitale.
-   Per il percorso selezionato restituire anno e capitale di fine anno.
-   Capitale annuale del grafico derivato dalla traiettoria mensile.
-   Nessuna traiettoria annuale indipendente.
-   Nessuna normalizzazione NAV 100.
-   Nessun arrotondamento durante la simulazione.
-   Tutti i percorsi mantengono la stessa lunghezza temporale.
-   Drawdown, CAGR e percentili rinviati ai rispettivi capitoli.


## Chiarimento consolidato v1.0 - bande annuali del capitale

Il capitale mensile resta la fonte ufficiale e non esiste una simulazione annuale separata. Il capitolo 24 introduce come output derivato il ventaglio annuale `P5/P25/P50/P75/P95`, calcolato a ogni fine anno sui capitali di tutti i percorsi. Questa regola prevale su eventuali formulazioni precedenti che escludano genericamente i percentili temporali. Non calcolare nella prima versione un fan mensile.
