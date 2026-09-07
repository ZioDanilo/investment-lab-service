# 22 - Drawdown e Recovery Time

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

Versione: 1.1

## 1. Scopo
Definire drawdown mensile, Max Drawdown, Recovery Time, aggregazioni KPI e gestione tecnica dei drawdown non recuperati usando la traiettoria mensile del capitale del capitolo 21.

## 2. Running peak
`runningPeak_0 = initialCapital`

Ogni mese:
`runningPeak_t = max(runningPeak_t-1, capital_t)`

Il capitale iniziale è il primo peak.

## 3. Drawdown mensile
`drawdown_t = capital_t / runningPeak_t - 1`

Il drawdown mensile è negativo o zero.

## 4. Nuovo massimo e recupero
- `capital > peak`: nuovo peak;
- `capital = peak`: recupero completo, drawdown zero;
- `capital < peak`: drawdown aperto.

Il running peak viene aggiornato numericamente soltanto quando il capitale supera il massimo precedente. L'uguaglianza è comunque sufficiente per considerare concluso il recovery.

## 5. Max Drawdown del percorso
Usare tutti i mesi del percorso.

`minimumDrawdown = min(drawdown_t)`

`maxDrawdown = abs(minimumDrawdown)`

Il Max Drawdown del percorso è memorizzato come magnitudine positiva.

## 6. Capitale zero
Se `capital = 0`:
- `drawdown = -1`;
- `maxDrawdown = 1`;
- il percorso continua a zero fino alla fine;
- il drawdown rimane non recuperato.

## 7. Dati non richiesti
Non calcolare un Max Drawdown annuale. Non è necessario conservare mese/data del Max Drawdown, trough o peak associato come campi autonomi.

## 8. Recovery Time
È adottata la definizione **A - tempo sott'acqua**.

L'episodio inizia nel primo mese in cui il capitale scende sotto il precedente peak e termina quando torna almeno al livello di quel peak. La durata comprende discesa e risalita, non soltanto trough-to-recovery.

## 9. Recovery Time del percorso
Per ogni episodio concluso calcolare la durata in mesi. Per ogni percorso conservare il massimo Recovery Time effettivamente concluso:

`maxRecoveryTimeMonths`

Non utilizzare la durata media degli episodi come KPI principale.

## 10. Drawdown non recuperato
Se a fine orizzonte il capitale è ancora sotto il peak:

`unrecovered = true`

Conservare internamente anche:

`unrecoveredDurationMonths`

La durata osservata non deve essere trasformata in Recovery Time concluso. Questi campi servono esclusivamente a correttezza tecnica/debug e non diventano KPI o statistiche sintetiche mostrate all'utente.

In particolare **non calcolare né mostrare `unrecoveredPathsPercentage`**: una percentuale semplice metterebbe sullo stesso piano drawdown aperti da durate radicalmente differenti.

## 11. Capitale zero e Recovery Time
Se il capitale arriva a zero e rimane zero, il Max Drawdown è 100%, l'episodio resta tecnicamente `unrecovered` e `unrecoveredDurationMonths` continua ad aumentare fino alla fine. Non viene trasformato in Recovery Time concluso.

## 12. KPI aggregato Max Drawdown
1. raccogliere `maxDrawdown` di tutti i percorsi;
2. ordinare crescente;
3. eliminare il 5% più basso;
4. eliminare il 5% più alto;
5. calcolare la media del 90% centrale.

È una **trimmed mean 5%-5%**. L'esclusione riguarda soltanto questo KPI.

## 13. KPI aggregato Recovery Time
Il KPI Recovery Time usa esclusivamente Recovery Time effettivamente conclusi.

1. raccogliere `maxRecoveryTimeMonths` dei percorsi con almeno un recovery concluso;
2. ordinare;
3. eliminare il 5% più basso;
4. eliminare il 5% più alto;
5. calcolare la media del 90% centrale.

Output: mesi.

Gli episodi ancora aperti non ricevono valori convenzionali o recovery fittizi.

## 14. Frontend
Portare al frontend:
- KPI Max Drawdown aggregato;
- KPI Recovery Time aggregato in mesi.

Non portare come statistica sintetica `unrecoveredPathsPercentage` o conteggi degli unrecovered. I campi tecnici possono restare nel backend per debug/verifiche.

## 15. Percorso rappresentativo
1. individuare il 5% dei percorsi con Max Drawdown maggiore;
2. tra questi scegliere quello con CAGR più vicino al `medianCAGR`.

Il `maxDrawdown` di ogni percorso deve restare disponibile.

## 16. Max Drawdown DB
Eventuali `max_drawdown` nei dati ETF non pilotano il drawdown simulato. Non imporli, non usarli come limite, non clampare la traiettoria e non correggere i rendimenti per avvicinarsi ad essi.

## 17. Precisione e controlli
Usare la traiettoria non arrotondata. Fail-fast per capitale negativo, NaN, Infinity, running peak non valido, drawdown positivo per errore e Max Drawdown fuori `[0,1]`. Capitale zero è valido.

## 18. Statistics
Il KPI Max Drawdown usa trimmed mean 5%-5%. Il KPI Recovery Time usa trimmed mean 5%-5% esclusivamente sui recovery conclusi. Gli unrecovered restano informazione tecnica interna e non sono sintetizzati in percentuali mostrate all'utente. I percentili sono disciplinati dal capitolo 24.

## 19. Decisioni definitive
- Drawdown mensile.
- Capitale iniziale primo peak.
- Drawdown mensile negativo/zero.
- Nuovo peak se il capitale supera il precedente.
- Capitale uguale al peak = recovery completo.
- Max Drawdown del percorso positivo.
- Capitale zero = Max Drawdown 100%.
- Nessun Max Drawdown annuale.
- Nessuna data autonoma del Max Drawdown.
- Recovery Time = intero tempo sott'acqua.
- Massimo Recovery Time concluso per percorso.
- Unrecovered e relativa durata mantenuti solo tecnicamente.
- Nessuna `unrecoveredPathsPercentage`.
- KPI Max Drawdown = trimmed mean 5%-5%.
- KPI Recovery Time = trimmed mean 5%-5% sui recovery conclusi.
- Percorso rappresentativo: 5% con DD maggiore, poi CAGR più vicino al medianCAGR.
- Max Drawdown DB non pilota la traiettoria.
- Nessuna autocorrezione.
