# Investment Lab X

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Monte Carlo Engine 2.0

# 01 - Contratto funzionale e definizione dei KPI

Versione: 1.2

## Obiettivo

Il motore Monte Carlo deve fornire sei KPI, tutti inizialmente allo
stesso livello e coerenti con la stessa simulazione mensile.

## KPI 1 - CAGR Robusto

Calcolare il CAGR di ogni percorso e applicare il criterio robusto
definito nel capitolo CAGR. Il risultato resta annualizzato.

## KPI 2 - Max Drawdown Robusto

Il drawdown è calcolato mensilmente. Il Max Drawdown del singolo
percorso è memorizzato come magnitudine positiva: una perdita del 30%
produce `maxDrawdown = 0.30`.

KPI aggregato: 1. ordinare i Max Drawdown di tutti i percorsi; 2.
eliminare il 5% con DD più basso; 3. eliminare il 5% con DD più alto; 4.
calcolare la media del 90% centrale.

È una trimmed mean 5%-5% calcolata sui CAGR di tutti i percorsi. Mediana, P95 e peggior caso non sono il KPI
principale.

## KPI 3 - Volatilità

Volatilità annualizzata del portafoglio simulato. La metodologia
aggregata definitiva appartiene al capitolo dedicato.

## KPI 4 - Indice di Decorrelazione

Per scenario: `rho_s = sum(w_i * w_j * rho_ij,s) / sum(w_i * w_j)`

Correlazione complessiva:
`rho* = 0.60 * correlazione_media_pesata + 0.40 * correlazione_massima_scenari`

I pesi degli scenari devono riflettere il processo macro effettivo
completo, non automaticamente la sola distribuzione stazionaria della
transition matrix.

`decorrelationIndex = 100 * (0.90 - rho*) / 0.80`

Limitare a `[0,100]`.

## KPI 5 - Indice Lantieri

`Indice Lantieri = Long Term Expected Return / Max Drawdown`

Il Max Drawdown è il KPI 2 come magnitudine positiva. Long Term Expected
Return resta annualizzato.

## KPI 6 - Recovery Time

Recovery Time = **tempo sott'acqua**: - inizia quando il capitale scende
sotto il precedente peak; - termina quando torna almeno al livello del
peak; - comprende discesa e risalita.

Per ogni percorso interessa il massimo Recovery Time.

Se il drawdown non recupera entro la fine: - `unrecovered = true`; -
conservare la durata maturata; - non dichiarare un recupero fittizio.

Il KPI è espresso in mesi e deve essere disponibile al frontend.
La gestione degli episodi `unrecovered` è definita nel capitolo 22: stato e durata restano tecnici/interni e non viene mostrata alcuna percentuale o conteggio sintetico degli unrecovered.

## Coerenza temporale

-   CAGR: annualizzato.
-   Volatilità: annualizzata.
-   Max Drawdown: magnitudine positiva.
-   Recovery Time: mesi.
-   Decorrelazione: adimensionale.
-   Indice Lantieri: adimensionale.

## Drawdown endogeno

Il Max Drawdown simulato emerge dalla traiettoria. Eventuali
`max_drawdown` nei dati ETF non devono imporre o limitare il drawdown
del percorso.

## KPI definitivi

1.  CAGR Robusto
2.  Max Drawdown Robusto
3.  Volatilità
4.  Indice di Decorrelazione
5.  Indice Lantieri
6.  Recovery Time

Recovery Time è il sesto KPI e non sostituisce nessuno dei cinque
precedenti.
