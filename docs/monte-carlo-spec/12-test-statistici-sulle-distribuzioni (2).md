# 12 - Test statistici sulle distribuzioni

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

Versione: 1.1

## Scopo

Validare empiricamente le distribuzioni marginali dei rendimenti ETF.
Statistics osserva e segnala, senza calibrazione automatica.

## Dataset

`10.000 percorsi × 50 anni × 12 mesi`, tutti gli ETF e tutti i quattro
macro-scenari.

## Test

Confrontare expected return teorico/empirical mean e volatility
teorica/empirica.

Analizzare Student-t grezza, Student-t standardizzata, shock accettato e
rendimento finale. Verificare media circa zero e deviazione standard
circa uno della Student-t standardizzata. Calcolare skewness, kurtosis
ed eventi oltre 2, 3 e 4 sigma.

Misurare estrazioni, accettazioni, rifiuti, reject rate e limite massimo
di redraw.

Analizzare per intensità: 0-20%, 20-40%, 40-60%, 60-80%, 80-100%.

Per le distribuzioni mensili mostrare almeno media, mediana, volatility,
minimo, massimo, percentili, skewness, kurtosis e istogramma.

Ricostruire i rendimenti annuali con:
`annualReturn = product(1 + monthlyReturn_i) - 1`

## Long-term expected return

Solo benchmark diagnostico:
`longTermDelta = empiricalCagr - longTermExpectedReturn`

## Drawdown emergente

Il drawdown emerge dalle traiettorie. - `drawdown_t`: negativo o zero; -
`maxDrawdown` del percorso: magnitudine positiva.

### KPI Max Drawdown aggiornato

La precedente definizione mediana/P95/peggior caso non è più il KPI
principale.

Il KPI è una trimmed mean 5%-5%: 1. raccogliere i Max Drawdown; 2.
ordinare; 3. eliminare il 5% più basso; 4. eliminare il 5% più alto; 5.
media del 90% centrale.

I percorsi esclusi da questa aggregazione restano nel Monte Carlo e
negli altri dataset.

## Recovery Time

Recovery Time è il sesto KPI.

Statistics deve rendere verificabili: - massimo Recovery Time per
percorso; - episodi `unrecovered`; - durata maturata degli
unrecovered come informazione tecnica/debug. Non calcolare né mostrare percentuali o conteggi sintetici degli unrecovered.

Recovery Time = intero tempo sott'acqua dal precedente peak al recupero.
Regole definitive nel capitolo 22.

## Errori e diagnostica

Le divergenze statistiche non causano normalmente fail-fast e non
vengono autocorrette.

Errori strutturali come NaN, Infinity, volatility negativa, intensity
fuori range, dati obbligatori mancanti o violazioni matematiche causano
fail-fast con contesto esplicito.

## Pagina Statistics

Devono restare consultabili almeno: - ETF; - scenario; - fascia
intensità; - distribuzione mensile e annuale; - Student-t; - shock
accettati; - reject rate; - percentili; - drawdown; - Recovery Time; -
benchmark di lungo periodo.

Nessuna persistenza DB iniziale. Il backend restituisce aggregati e dati
utili alla visualizzazione.

## Correlazioni escluse

Correlazioni empiriche ETF-ETF, PSD, copula e shock correlati
appartengono ai capitoli dedicati.

## Decisioni definitive

-   10.000 × 50 × 12.
-   Test mean, volatility, Student-t, code, reject rate e intensità.
-   Annuali composti.
-   Long-term expected return solo benchmark.
-   Max Drawdown positivo come magnitudine a livello KPI.
-   KPI Max Drawdown = trimmed mean 5%-5%.
-   Recovery Time incluso nelle diagnostiche.
-   Nessuna calibrazione automatica.
-   Errori strutturali in fail-fast.
-   Nessun seed.
