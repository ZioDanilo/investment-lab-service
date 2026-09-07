# Monte Carlo Engine Specification — v1.1 consolidata

## Scopo
Entry point della specifica del motore Monte Carlo di Investment Lab X. Leggere questo file e tutti i capitoli `01`–`27` prima dell'implementazione.

## Regole per VS Code / coding agent
**MUST:** preservare formule, unità e ordine temporale; validare prima della simulazione; caricare un unico snapshot DB; separare precalcolo, simulazione, metriche, Statistics e output.

**MUST NOT:** inventare fallback/default; aggiungere property o soglie non documentate; autocalibrare; interrogare il DB nel loop Monte Carlo; arrotondare nel motore; mostrare percentuale/conteggio `unrecovered`; restituire risultati parziali come validi dopo errori strutturali.

## Gerarchia
1. Questo file governa le regole globali.
2. Il capitolo specialistico governa la formula/il concetto che definisce.
3. Il capitolo 27 governa ordine temporale, dipendenze e orchestrazione.
4. I capitoli 25 e 26 governano collaudo e performance.
5. Se resta un conflitto, non scegliere arbitrariamente: segnalarlo.

## Convenzioni globali
- Percentuali/rendimenti interni decimali (`0.08 = 8%`).
- Simulazione mensile; orizzonte utente in anni.
- Capitale reale, nessun NAV 100.
- Long-only, no leva, no cash; pesi target somma 1 entro `1e-6`.
- Calcoli `double`, nessun rounding nel motore.
- Max Drawdown esposto come magnitudine positiva; Recovery Time in mesi.
- Nessun seed esposto o salvato.

## Sei KPI definitivi
1. **CAGR Robusto** — CAGR per-path, trimmed mean 5%-5%.
2. **Max Drawdown Robusto** — MaxDD positivo per-path, trimmed mean 5%-5%.
3. **Volatilità**.
4. **Indice di Decorrelazione**.
5. **Indice Lantieri** — Long Term Expected Return / Max Drawdown.
6. **Recovery Time** — trimmed mean 5%-5% solo sui recovery completati.

`medianCAGR` è tecnico/diagnostico e coincide con P50 CAGR. `unrecovered` e durata restano tecnici; nessuna percentuale/conteggio sintetico mostrato.

## Costanti fisse principali
- Student-t marginale ν=5; t-copula ν=5.
- Standardizzazione Student-t `sqrt(3/5)`.
- Floor volatilità a intensità zero = 30%.
- Correlation epsilon `1e-6`; copula clamp epsilon `1e-12`.
- `MAX_REDRAWS=1000`; `WEIGHT_EPSILON=1e-6`.
- Percentili `P5/P25/P50/P75/P95`.
- Trimming KPI robusti 5% basso + 5% alto.

## Ordine mensile autoritativo
1. Scenario e intensità del mese sono già fissati.
2. Derivare parametri ETF effettivi.
3. Generare shock correlati con t-copula.
4. Applicare range/reject-redraw all'intero vettore.
5. Calcolare rendimenti ETF.
6. Calcolare rendimento portafoglio e aggiornare posizioni/capitale.
7. Aggiornare Drawdown/Recovery e statistiche.
8. A fine dicembre registrare capitale/statistiche annuali.
9. Se esiste un anno successivo, ribilanciare dopo la registrazione.
10. Se esiste un mese successivo, determinare a fine mese scenario/intensità del mese successivo.
11. Nessun ribilanciamento finale.

Il primo scenario deriva da `structural_probability`.

## Portafoglio, percentili e fan
Le posizioni driftano durante l'anno. Il ribilanciamento è annuale completo verso i target originali, senza costi/tasse e senza cambiare il capitale totale.

Il capitale mensile è la fonte ufficiale. Il fan annuale usa `P5/P25/P50/P75/P95` sui capitali di fine anno di tutti i path; non esiste simulazione annuale separata.

I percentili finali riguardano final capital, CAGR, MaxDD e Recovery Time completati; nessun trimming. Interpolazione quantile lineare.

## Errori e performance
Violazioni strutturali/matematiche: fail-fast. Un errore strutturale di un worker invalida l'intera run. Le anomalie statistiche sono diagnostiche.

Flusso: `DB -> snapshot -> validation -> precomputation -> simulation`. Nessuna query DB nel loop. Parallelizzare automaticamente i path indipendenti.

## Representative path
Tra il 5% dei path con MaxDD maggiore, scegliere quello con CAGR più vicino a `medianCAGR`. Usare la traiettoria già simulata; non rieseguire il path.

## Output logico
`mainKpis`, `percentiles`, `capitalFan`, `representativePath`, `statistics`, `technicalChecks`, `performanceMetrics`.

## Decisioni aggiuntive v1.1

### Sede di esecuzione

Il Monte Carlo autoritativo della prima versione gira nel **frontend tramite Web Workers**.

Il backend ha responsabilità di:
- leggere il database;
- costruire uno snapshot completo e coerente;
- validare la completezza strutturale dei dati;
- restituire lo snapshot al frontend tramite API.

Il frontend ha responsabilità di:
- validare nuovamente il contratto ricevuto prima della simulazione;
- eseguire precalcolo e simulazione;
- distribuire i path tra Web Workers;
- aggregare i risultati;
- costruire gli output ufficiali.

La UI Angular principale NON deve eseguire il loop Monte Carlo sul main thread.

### Dinamica persistente dell'intensità

Quando lo scenario permane, l'intensità segue un processo AR(1) mean-reverting verso `mean_intensity` dello scenario.

Costante tecnica fissa:

`INTENSITY_AR_RHO = 0.85`

Per scenario `s`:

`conditionalMean = mean_s + rho * (previousIntensity - mean_s)`

`conditionalStdDev = stdDev_s * sqrt(1 - rho^2)`

La nuova intensità viene estratta da una Gaussiana troncata nell'intervallo:

`[max(0, previousIntensity - maxMonthlyVariation), min(1, previousIntensity + maxMonthlyVariation)]`

con media `conditionalMean` e deviazione standard `conditionalStdDev`.

Questa formulazione conserva memoria, mean reversion, variabilità stocastica e il limite mensile senza introdurre clamp ex-post.

### Primi due mesi di un nuovo scenario

Le soglie `0.40` e `0.70` restano **soft threshold**, non hard cap.

- primo mese del nuovo scenario: distribuzione Gaussiana troncata scenario-specifica adattata affinché il 95° percentile sia `<= 0.40`;
- secondo mese: distribuzione condizionata AR(1), con vincolo di variazione mensile, adattata affinché il 95° percentile sia `<= 0.70`;
- dal terzo mese: normale dinamica AR(1) mean-reverting.

L'adattamento deve spostare verso il basso la media della distribuzione soltanto se necessario, mantenendo invariata la deviazione standard prevista per quella fase. La media adattata viene trovata deterministicamente mediante bisezione sulla CDF della normale troncata fino a ottenere il percentile richiesto.

Costanti tecniche fisse:
- `ENTRY_SOFT_QUANTILE = 0.95`;
- `INTENSITY_MEAN_SOLVER_TOLERANCE = 1e-10`;
- `INTENSITY_MEAN_SOLVER_MAX_ITERATIONS = 100`.

Se la distribuzione non adattata soddisfa già la soglia, non viene modificata.

L'intensità iniziale assoluta della simulazione NON è considerata ingresso in un nuovo scenario: viene estratta dalla normale troncata base dello scenario iniziale.

### Nearest correlation matrix

Il capitolo 14 viene reso deterministico usando l'algoritmo di Higham con alternating projections e correzione di Dykstra.

Costanti:
- `NEAREST_CORRELATION_TOLERANCE = 1e-10`;
- `NEAREST_CORRELATION_MAX_ITERATIONS = 100`.

Il limite già presente `MAX_CORRELATION_CELL_DELTA = 0.02` è confermato.

## Indice
01. [`01-contratto-funzionale.md`](./01-contratto-funzionale.md) — Investment Lab X
02. [`02-modello-dati-validazioni.md`](./02-modello-dati-validazioni.md) — 02 - Modello dati e unità di misura
03. [`03-generazione-casuale.md`](./03-generazione-casuale.md) — 03 - generazione-casuale
04. [`04-selezione-dello-scenario-del-primo-anno.md`](./04-selezione-dello-scenario-del-primo-anno.md) — 04-selezione-dello-scenario-del-primo-anno
05. [`05-catena-di-markov-e-transizione-degli-scenari.md`](./05-catena-di-markov-e-transizione-degli-scenari.md) — 05-catena-di-markov-e-transizione-degli-scenari
06. [`06-validazione-statistica-degli-scenari.md`](./06-validazione-statistica-degli-scenari.md) — 06-validazione-statistica-degli-scenari
07. [`07-significato-e-ruolo-dei-parametri-di-rendimento.md`](./07-significato-e-ruolo-dei-parametri-di-rendimento.md) — 07-significato-e-ruolo-dei-parametri-di-rendimento
08. [`08-trasformazione-annuale-mensile.md`](./08-trasformazione-annuale-mensile.md) — 08-trasformazione-annuale-mensile
09. [`09-distribuzione-dei-rendimenti.md`](./09-distribuzione-dei-rendimenti.md) — 09-distribuzione-dei-rendimenti
10. [`10-gaussiana-beta-o-altra-distribuzione.md`](./10-gaussiana-beta-o-altra-distribuzione.md) — 10-gaussiana-beta-o-altra-distribuzione
11. [`11-ruolo-dell-intensita.md`](./11-ruolo-dell-intensita.md) — 11-ruolo-dell-intensita
12. [`12-test-statistici-sulle-distribuzioni.md`](./12-test-statistici-sulle-distribuzioni.md) — 12 - Test statistici sulle distribuzioni
13. [`13-costruzione-e-validazione-delle-matrici.md`](./13-costruzione-e-validazione-delle-matrici.md) — 13-costruzione-e-validazione-delle-matrici
14. [`14-correzione-delle-matrici-non-valide.md`](./14-correzione-delle-matrici-non-valide.md) — 14-correzione-delle-matrici-non-valide
15. [`15-generazione-degli-shock-correlati.md`](./15-generazione-degli-shock-correlati.md) — 15-generazione-degli-shock-correlati
16. [`16-copula.md`](./16-copula.md) — 16-copula
17. [`17-controllo-delle-correlazioni-empiriche.md`](./17-controllo-delle-correlazioni-empiriche.md) — 17-controllo-delle-correlazioni-empiriche
18. [`18-rendimento-ponderato.md`](./18-rendimento-ponderato.md) — 18-rendimento-ponderato
19. [`19-ribilanciamento.md`](./19-ribilanciamento.md) — 19-ribilanciamento
20. [`20-interesse-composto.md`](./20-interesse-composto.md) — 20-interesse-composto
21. [`21-capitale.md`](./21-capitale.md) — 21-capitale
22. [`22-drawdown.md`](./22-drawdown.md) — 22 - Drawdown e Recovery Time
23. [`23-cagr.md`](./23-cagr.md) — 23 - CAGR
24. [`24-percentili-dei-risultati.md`](./24-percentili-dei-risultati.md) — 24 - Percentili dei risultati
25. [`25-collaudo-progressivo.md`](./25-collaudo-progressivo.md) — 25 - Collaudo progressivo
26. [`26-performance-e-ottimizzazione.md`](./26-performance-e-ottimizzazione.md) — 26 - Performance e ottimizzazione
27. [`27-architettura-finale-e-flusso-completo.md`](./27-architettura-finale-e-flusso-completo.md) — 27 - Architettura finale e flusso completo

## Checklist di conformità
- [ ] Tutti i capitoli letti.
- [ ] Nessun fallback/default arbitrario.
- [ ] Nessuna query DB nel loop.
- [ ] Scenario/intensità fissati prima dei rendimenti mensili.
- [ ] Scenario successivo deciso a fine mese.
- [ ] Student-t e t-copula ν=5.
- [ ] Reject/redraw dell'intero vettore.
- [ ] Ribilanciamento annuale dopo il valore di fine anno; nessun ribilanciamento finale.
- [ ] CAGR Robusto e MaxDD Robusto = trimmed mean 5%-5%.
- [ ] Recovery Time robusto solo sui recovery completati.
- [ ] Nessuna percentuale/conteggio unrecovered mostrato.
- [ ] P50 CAGR = `medianCAGR`.
- [ ] Fan annuale capitale P5/P25/P50/P75/P95.
- [ ] Zero capital resta zero.
- [ ] Nessun rounding nel motore.
- [ ] Nessuna autocalibrazione.
- [ ] Representative path senza rerun.
