# 24 - Percentili dei risultati

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

Versione: 1.0

## 1. Scopo
Definire i percentili utilizzati per descrivere la distribuzione dei risultati Monte Carlo senza introdurre nuovi KPI.

## 2. Percentili standard
Utilizzare P5, P25, P50, P75 e P95. P50 coincide con la mediana.

## 3. Nessun trimming nei percentili
Il trimming 5%-5% dei KPI CAGR Robusto e Max Drawdown Robusto non si applica ai percentili.

Per capitale finale, CAGR e Max Drawdown i percentili usano il **100% dei percorsi Monte Carlo**.

## 4. Capitale finale
Calcolare P5/P25/P50/P75/P95 sui `finalCapital` di tutti i percorsi. Gli zeri partecipano normalmente. Nessuna esclusione, winsorization o sostituzione.

## 5. CAGR
Calcolare P5/P25/P50/P75/P95 sui CAGR di tutti i percorsi, inclusi CAGR = -100%.

Distinguere:
- `CAGR Robusto`: KPI, trimmed mean 5%-5%;
- `P50 CAGR`: mediana della distribuzione completa;
- altri percentili: statistiche della distribuzione completa.

Il `medianCAGR` del capitolo 23 coincide con `P50 CAGR` e deve provenire dalla stessa implementazione.

## 6. Max Drawdown
Calcolare P5/P25/P50/P75/P95 sui `maxDrawdown` di tutti i percorsi usando la convenzione positiva del capitolo 22.

Esempio: `P95 Max Drawdown = 0.55` significa che il 95% dei percorsi ha Max Drawdown <=55% e il 5% presenta un valore superiore.

Il KPI Max Drawdown Robusto resta distinto ed è una trimmed mean 5%-5%.

## 7. Recovery Time
Calcolare P5/P25/P50/P75/P95 esclusivamente sui Recovery Time **effettivamente conclusi**, usando i `maxRecoveryTimeMonths` validi del capitolo 22.

I drawdown ancora aperti non vengono trasformati artificialmente in Recovery Time e non entrano nei percentili.

Non includere `unrecoveredDurationMonths` né valori convenzionali.

Non mostrare percentuale o conteggio sintetico degli unrecovered. `unrecovered` e `unrecoveredDurationMonths` restano dati tecnici interni.

## 8. Grandezze senza percentili
Nella prima versione non calcolare percentili per:
- Indice di Decorrelazione;
- Indice Lantieri;
- volatilità.

## 9. Bande temporali del capitale
A ogni fine anno raccogliere il capitale di tutti i percorsi e calcolare P5/P25/P50/P75/P95.

Questi valori alimentano il grafico a bande/ventaglio Monte Carlo e derivano dalle traiettorie già simulate. Non eseguire nuove simulazioni.

## 10. Granularità del ventaglio
Il ventaglio usa valori di **fine anno**. La simulazione resta mensile, ma non è necessario inviare bande mensili nella prima versione.

## 11. Percorsi a zero nelle bande
I percorsi a zero partecipano normalmente ai percentili temporali e continuano a contribuire con zero negli anni successivi.

## 12. Algoritmo percentile
Usare un'unica implementazione backend dei quantili. Quando la posizione percentile cade tra due osservazioni ordinate, usare **interpolazione lineare** tra le osservazioni adiacenti.

Frontend e backend non devono usare convenzioni differenti.

## 13. Backend come fonte unica
Tutti i percentili vengono calcolati nel backend. Il frontend riceve, formatta e visualizza i valori; non ricalcola i percentili.

## 14. Output risultati
Rendere disponibili P5/P25/P50/P75/P95 per:
- capitale finale;
- CAGR;
- Max Drawdown;
- Recovery Time sui soli recovery conclusi.

## 15. Output ventaglio capitale
Per ogni anno restituire almeno:

```text
year
capitalP5
capitalP25
capitalP50
capitalP75
capitalP95
```

## 16. Relazione con i KPI
I percentili non sostituiscono i sei KPI.

- CAGR Robusto resta trimmed mean 5%-5%.
- Max Drawdown Robusto resta trimmed mean 5%-5%.
- Recovery Time KPI resta definito dal capitolo 22.
- P50 non sostituisce automaticamente un KPI robusto.

## 17. Statistics e frontend
La tabella completa dei percentili deve essere disponibile nella pagina Statistics.

Nel frontend principale possono essere utilizzati percentili del capitale finale, percentili CAGR e ventaglio annuale del capitale. Max Drawdown e Recovery Time possono essere mostrati nella sezione risultati/Statistics senza creare nuovi KPI.

## 18. Nessuna nuova configurazione
Non introdurre nuove property, tabelle DB, soglie o percentili configurabili. P5/P25/P50/P75/P95 sono una scelta tecnica fissa.

## 19. Precisione
Calcolare sui valori non arrotondati. Formattazione solo in output/frontend.

Per Recovery Time i valori di origine sono mesi interi; l'interpolazione può produrre un percentile decimale, che il backend conserva senza alterare il calcolo.

## 20. Validazioni
Verificare campione non vuoto, assenza di NaN/Infinity, capitale finale >=0, CAGR >=-1, Max Drawdown in `[0,1]`, Recovery Time concluso >=0.

Se non esiste alcun Recovery Time concluso, i relativi percentili devono risultare non disponibili/null. Non inventare valori.

## 21. Decisioni definitive
- P5/P25/P50/P75/P95.
- Nessun trimming nei percentili.
- Capitale finale: 100% percorsi.
- CAGR: 100% percorsi.
- Max Drawdown: 100% percorsi.
- Recovery Time: solo recovery conclusi.
- Nessuna percentuale unrecovered mostrata.
- Nessun percentile per Decorrelazione, Indice Lantieri o volatilità nella prima versione.
- P50 CAGR = `medianCAGR`.
- Bande annuali P5/P25/P50/P75/P95 del capitale.
- Percorsi a zero inclusi.
- Interpolazione lineare.
- Calcolo esclusivamente backend.
- Nessuna nuova configurazione DB/property.
- Nessun arrotondamento durante il calcolo.
- Campione Recovery Time vuoto -> null/non disponibile.
