# 27 - Architettura finale e flusso completo

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

Versione: 1.0

## 1. Scopo

Definire l'orchestrazione completa del Monte Carlo Engine e collegare in
un unico flusso operativo le regole definite nei capitoli 1-26.

Questo capitolo non introduce una nuova matematica.

Definisce:

-   ordine di esecuzione;
-   dipendenze;
-   responsabilità logiche;
-   ciclo di vita di una simulazione;
-   ciclo mensile di un percorso;
-   aggregazione finale;
-   gestione degli errori.

------------------------------------------------------------------------

## 2. Regola di prevalenza

Il capitolo 27 è un capitolo di orchestrazione.

Non ridefinisce le formule contenute nei capitoli specialistici
precedenti.

In caso di dubbio:

-   la formula matematica è definita dal relativo capitolo
    specialistico;
-   il capitolo 27 definisce quando quella formula viene applicata;
-   il capitolo 27 definisce quali dati devono essere disponibili prima
    della sua applicazione.

Non duplicare formule in più componenti con implementazioni
indipendenti.

------------------------------------------------------------------------

## 3. Flusso generale

Il flusso complessivo è:

``` text
Input frontend
↓
Caricamento configurazione DB
↓
Snapshot configurazione
↓
Validazione completa
↓
Precalcolo
↓
Preparazione strutture runtime
↓
Esecuzione path in parallelo
↓
Aggregazione risultati per-path
↓
KPI
↓
Percentili
↓
Bande annuali
↓
Percorso rappresentativo
↓
Statistics
↓
Assemblaggio risultato
↓
Frontend
```

------------------------------------------------------------------------

## 4. Input frontend

L'esecuzione parte dai dati già previsti dall'applicazione.

Devono essere disponibili almeno:

-   portafoglio selezionato;
-   composizione iniziale;
-   pesi target;
-   capitale iniziale;
-   orizzonte temporale in anni.

Il motore lavora internamente con granularità mensile:

`months = years × 12`

Il capitale iniziale reale fornito dal frontend è utilizzato
direttamente.

Non introdurre NAV iniziale convenzionale pari a 100.

------------------------------------------------------------------------

## 5. Caricamento configurazione

Prima della simulazione caricare dal database tutti i dati necessari.

Lo snapshot deve comprendere, quando previsti dai capitoli precedenti:

-   ETF del portafoglio;
-   parametri ETF per scenario;
-   parametri `general`;
-   `structural_probability`;
-   `transition_matrix`;
-   parametri di inerzia per scenario;
-   correlazioni ETF;
-   eventuali altre configurazioni già definite dal modello.

Non effettuare caricamenti progressivi durante i path.

------------------------------------------------------------------------

## 6. Snapshot

Dopo il caricamento, costruire uno snapshot in memoria della
configurazione utilizzata dalla simulazione.

Lo snapshot rappresenta la configurazione logica del run.

Durante l'esecuzione non dipendere da nuove query DB per recuperare dati
necessari al calcolo.

Regola:

``` text
DB → snapshot → simulazione
```

e non:

``` text
simulazione → query DB → simulazione → query DB
```

------------------------------------------------------------------------

## 7. Validazione prima dell'avvio

La validazione completa deve avvenire prima dell'esecuzione Monte Carlo.

Controllare almeno:

-   presenza dei dati obbligatori;
-   pesi;
-   probabilità strutturali;
-   transition matrix;
-   parametri di inerzia;
-   parametri ETF;
-   unità;
-   volatility;
-   expected return;
-   return range;
-   correlazioni;
-   duplicati;
-   completezza delle coppie ETF;
-   validità delle matrici.

Se manca un dato necessario, la simulazione non parte.

Non utilizzare fallback economici impliciti.

------------------------------------------------------------------------

## 8. Precalcolo

Dopo la validazione effettuare i calcoli invarianti.

Precalcolare almeno, quando applicabile:

-   expected return mensili;
-   volatility mensili;
-   trasformazioni del return range;
-   z-score derivati;
-   matrici di correlazione;
-   eventuali correzioni PSD;
-   fattorizzazioni;
-   strutture della copula;
-   target weights;
-   lookup ETF/scenario;
-   costanti Student-t;
-   altre costanti matematiche.

Il precalcolo deve terminare prima del loop principale quando il dato è
invariabile.

------------------------------------------------------------------------

## 9. Preparazione dei path

Creare il numero di percorsi richiesto dalla simulazione.

Ogni path deve avere stato indipendente.

Lo stato comprende almeno:

-   capitale;
-   posizioni ETF;
-   pesi correnti derivati;
-   scenario corrente;
-   durata scenario;
-   intensità corrente;
-   stato necessario alla continuità dell'intensità;
-   running peak;
-   stato drawdown;
-   stato Recovery Time;
-   risultati per-path;
-   accumulatori necessari.

I path possono essere distribuiti in batch e worker paralleli.

------------------------------------------------------------------------

## 10. Inizializzazione del portafoglio

Per ogni percorso:

`positionValue_i,0 = initialCapital × targetWeight_i`

Verificare:

`sum(positionValue_i,0) ≈ initialCapital`

I pesi target restano immutabili durante l'intera simulazione.

I pesi correnti possono invece cambiare per effetto dei rendimenti.

------------------------------------------------------------------------

## 11. Scenario iniziale

Nel primo mese del primo anno lo scenario iniziale viene estratto
casualmente utilizzando:

`structural_probability`

Non utilizzare la transition matrix per determinare il primo scenario.

L'ingresso nello scenario iniziale attiva le regole di ingresso previste
dai capitoli 5 e 11.

------------------------------------------------------------------------

## 12. Regola temporale fondamentale

Scenario e intensità utilizzati per generare i rendimenti del mese `t`
devono essere già determinati all'inizio del mese `t`.

Non modificare lo scenario a metà del calcolo del mese.

Schema:

``` text
inizio mese t
→ scenario_t noto
→ intensity_t nota
→ rendimenti del mese t
→ aggiornamento portafoglio
→ metriche del mese t
→ decisione scenario del mese t+1
```

Questa regola elimina ambiguità temporali.

------------------------------------------------------------------------

## 13. Intensità del primo mese

Dopo l'estrazione dello scenario iniziale generare l'intensità del primo
mese secondo la distribuzione e le regole definite nel capitolo 11.

Applicare la regola soft prevista per il primo mese di ingresso nello
scenario.

L'intensità è unica per il mese e condivisa da tutti gli ETF del
percorso.

------------------------------------------------------------------------

## 14. Ciclo mensile

Per ogni mese eseguire concettualmente:

``` text
1. leggere scenario corrente
2. leggere/generare intensità corrente
3. costruire parametri ETF effettivi
4. generare shock correlati tramite copula
5. costruire rendimenti ETF
6. validare return range / eventuale redraw
7. calcolare rendimento ponderato del portafoglio
8. aggiornare posizioni ETF
9. aggiornare capitale
10. aggiornare pesi correnti
11. aggiornare drawdown
12. aggiornare Recovery Time
13. aggiornare aggregatori Statistics
14. gestire eventuale fine anno
15. determinare scenario del mese successivo
16. preparare intensità del mese successivo
```

L'implementazione può organizzare internamente le funzioni in modo
diverso, purché rispetti le dipendenze matematiche e temporali.

------------------------------------------------------------------------

## 15. Parametri ETF effettivi

Dato lo scenario e l'intensità del mese, costruire per ciascun ETF:

-   expected return mensile effettivo;
-   volatility mensile effettiva;
-   return range effettivo.

Applicare le formule dei capitoli 8 e 11.

L'intensità del mese è condivisa, ma ogni ETF utilizza i propri
parametri dello scenario.

------------------------------------------------------------------------

## 16. Generazione degli shock

Generare un unico vettore di shock correlati per:

-   percorso;
-   mese;
-   insieme degli ETF.

Applicare:

-   matrice operativa;
-   fattorizzazione;
-   t-copula;
-   Student-t standardizzata;
-   regole definite nei capitoli 9, 15 e 16.

Non generare separatamente gli ETF perdendo la struttura di
correlazione.

------------------------------------------------------------------------

## 17. Return range e redraw

Dopo aver costruito i rendimenti ETF, verificare i rispettivi return
range effettivi.

Se almeno un ETF viola il proprio range:

-   rifiutare l'intero vettore;
-   rigenerare l'intero vettore;
-   rigenerare anche la componente comune della t-copula;
-   incrementare i contatori diagnostici.

Non correggere soltanto l'ETF fuori range.

Rispettare:

`MAX_REDRAWS = 1000`

Se il limite viene superato:

`FAIL`

con contesto preciso.

------------------------------------------------------------------------

## 18. Rendimento del portafoglio

Prima di applicare i rendimenti calcolare i pesi correnti di inizio
mese:

`currentWeight_i,t = positionValue_i,t / portfolioValue_t`

quando il capitale è maggiore di zero.

Il rendimento mensile del portafoglio è:

`portfolioReturn_t = sum(currentWeight_i,t × ETFReturn_i,t)`

Applicare le regole del capitolo 18.

------------------------------------------------------------------------

## 19. Aggiornamento delle posizioni

Per ogni ETF:

`positionValue_i,t+1 = positionValue_i,t × (1 + ETFReturn_i,t)`

Il valore del portafoglio aggiornato è:

`portfolioValue_t+1 = sum(positionValue_i,t+1)`

Deve essere coerente con la capitalizzazione tramite
`portfolioReturn_t`.

------------------------------------------------------------------------

## 20. Capitale zero

Se il capitale raggiunge esattamente zero:

-   il path resta valido;
-   il capitale rimane zero fino alla fine;
-   le posizioni rimangono zero;
-   il ribilanciamento non può ricreare capitale;
-   Max Drawdown raggiunge 100%;
-   l'episodio di drawdown resta tecnicamente unrecovered.

Il path deve comunque contribuire ai risultati secondo le regole dei
capitoli successivi.

È consentita un'ottimizzazione computazionale che eviti calcoli inutili,
purché la timeline logica completa venga preservata.

------------------------------------------------------------------------

## 21. Aggiornamento drawdown

Dopo l'aggiornamento del capitale del mese:

1.  confrontare il capitale con il running peak;
2.  calcolare il drawdown;
3.  aggiornare il running peak quando previsto;
4.  aggiornare il Max Drawdown del path.

Applicare integralmente il capitolo 22.

Il drawdown è quindi calcolato sul capitale risultante dal rendimento
del mese.

------------------------------------------------------------------------

## 22. Aggiornamento Recovery Time

Nello stesso passaggio mensile aggiornare lo stato del Recovery Time.

Gestire:

-   ingresso sotto il peak;
-   prosecuzione del periodo underwater;
-   nuovo trough senza reset della durata;
-   recupero del peak;
-   chiusura dell'episodio;
-   aggiornamento del massimo Recovery Time concluso.

Un episodio aperto a fine simulazione rimane tecnicamente unrecovered e
non viene trasformato in un recovery concluso.

------------------------------------------------------------------------

## 23. Statistics mensili

Durante il mese aggiornare gli aggregatori necessari alla Statistics.

Quando possibile utilizzare aggregazioni progressive e locali al
worker/batch.

Non memorizzare ogni osservazione se non necessaria.

Devono comunque essere preservati i dati richiesti dai capitoli
specifici per:

-   test statistici;
-   correlazioni;
-   intensità;
-   scenari;
-   reject rate;
-   altre diagnostiche.

------------------------------------------------------------------------

## 24. Decisione dello scenario successivo

Dopo aver completato economicamente il mese corrente, determinare lo
scenario del mese successivo.

La decisione utilizza:

-   scenario corrente;
-   durata nello scenario;
-   intensità corrente;
-   soglia globale di intensità prevista;
-   entry persistence;
-   persistence;
-   `entry_months`;
-   `exit_start_month`;
-   `exit_decay`;
-   transition matrix.

Applicare esattamente il capitolo 5.

------------------------------------------------------------------------

## 25. Filtro dell'intensità sulla transizione

Se l'intensità corrente supera la soglia globale prevista dal modello,
lo scenario non cambia.

Se non la supera, applicare:

``` text
inertia
↓
se la protezione non trattiene lo scenario
↓
transition matrix
```

Inertia e transition matrix restano meccanismi distinti.

------------------------------------------------------------------------

## 26. Preparazione dell'intensità successiva

Una volta determinato `scenario_t+1`:

### Nuovo scenario

Se:

`scenario_t+1 != scenario_t`

il mese successivo è il primo mese del nuovo scenario.

Applicare le regole soft di ingresso.

### Scenario persistente

Se:

`scenario_t+1 = scenario_t`

generare l'intensità successiva mantenendo la continuità/correlazione
temporale prevista.

### Secondo mese dopo ingresso

Applicare la specifica regola soft prevista per il secondo mese.

Il valore così ottenuto sarà l'intensità utilizzata all'inizio del mese
successivo.

------------------------------------------------------------------------

## 27. Fine anno

Dopo il rendimento di dicembre eseguire nell'ordine:

``` text
rendimento dicembre
↓
aggiornamento posizioni
↓
aggiornamento capitale
↓
drawdown / Recovery Time
↓
registrazione capitale di fine anno
↓
Statistics annuali
↓
eventuale ribilanciamento
```

Il capitale di fine anno viene quindi registrato **prima** del
ribilanciamento.

------------------------------------------------------------------------

## 28. Ribilanciamento annuale

Se esiste almeno un mese successivo alla fine dell'anno corrente,
applicare il ribilanciamento annuale.

Riportare integralmente le posizioni ai target:

`positionValueAfter_i = portfolioValueBefore × targetWeight_i`

Il capitale totale non cambia.

Registrare le metriche di turnover previste dal capitolo 19.

------------------------------------------------------------------------

## 29. Nessun ribilanciamento finale

Dopo l'ultimo mese dell'orizzonte:

-   registrare il capitale finale;
-   non eseguire un ribilanciamento privo di periodo successivo.

Il ribilanciamento ha senso soltanto se il portafoglio continuerà a
essere simulato.

------------------------------------------------------------------------

## 30. Chiusura del path

Dopo l'ultimo mese costruire i risultati sintetici del percorso.

Calcolare/conservare almeno:

-   `finalCapital`;
-   `totalReturn`;
-   `CAGR`;
-   `maxDrawdown`;
-   `maxRecoveryTimeMonths` quando disponibile;
-   stato tecnico di eventuale drawdown aperto;
-   dati necessari ai KPI;
-   dati necessari ai percentili;
-   dati necessari alla scelta del percorso rappresentativo.

Il CAGR viene calcolato sull'intero orizzonte.

------------------------------------------------------------------------

## 31. Traiettoria del capitale

Durante l'esecuzione conservare temporaneamente la traiettoria mensile
del capitale secondo il capitolo 26.

Questa serve a:

-   recuperare il percorso rappresentativo senza riesecuzione;
-   derivare valori annuali;
-   costruire le bande del capitale;
-   supportare le visualizzazioni previste.

Non introdurre seed per rigenerare successivamente il path.

------------------------------------------------------------------------

## 32. Completamento di tutti i path

Le aggregazioni globali definitive che richiedono l'intero campione
devono essere eseguite soltanto dopo il completamento valido di tutti i
percorsi.

Nessun risultato parziale deve essere presentato come risultato Monte
Carlo definitivo.

------------------------------------------------------------------------

## 33. CAGR Robusto

Raccogliere i CAGR per-path.

Applicare la trimmed mean:

-   eliminare 5% inferiore;
-   eliminare 5% superiore;
-   media del 90% centrale.

Il risultato è:

`CAGR Robusto`

P50 CAGR resta `medianCAGR` tecnico e percentile.

------------------------------------------------------------------------

## 34. Max Drawdown Robusto

Raccogliere i Max Drawdown per-path come magnitudini positive.

Applicare:

-   esclusione 5% inferiore;
-   esclusione 5% superiore;
-   media del 90% centrale.

Il risultato è il KPI Max Drawdown Robusto.

------------------------------------------------------------------------

## 35. Recovery Time aggregato

Utilizzare esclusivamente i Recovery Time effettivamente conclusi
secondo il capitolo 22.

Applicare la trimmed mean 5%-5% al campione valido.

Non trasformare gli unrecovered in valori numerici fittizi.

Non mostrare una percentuale aggregata degli unrecovered.

------------------------------------------------------------------------

## 36. Percentili

Dopo il completamento dei path calcolare:

`P5, P25, P50, P75, P95`

per:

-   capitale finale;
-   CAGR;
-   Max Drawdown;
-   Recovery Time secondo le regole specifiche.

Non applicare trimming ai percentili.

Per capitale, CAGR e Max Drawdown utilizzare il 100% dei path.

Per Recovery Time utilizzare soltanto i recovery conclusi.

------------------------------------------------------------------------

## 37. Bande annuali del capitale

Per ogni anno raccogliere il capitale di fine anno di tutti i path.

Calcolare:

-   P5;
-   P25;
-   P50;
-   P75;
-   P95.

Costruire la struttura del ventaglio Monte Carlo definita nel capitolo
24.

I percorsi a capitale zero partecipano normalmente.

------------------------------------------------------------------------

## 38. Volatilità

Calcolare la volatilità secondo la definizione del relativo KPI e dei
capitoli specialistici.

Non ricavare una volatilità alternativa dal solo capitale finale.

Utilizzare la serie e la granularità definite dal modello.

------------------------------------------------------------------------

## 39. Indice di Decorrelazione

Calcolare l'Indice di Decorrelazione soltanto dopo che sono disponibili
i dati necessari definiti dal relativo contratto.

Non modificare le correlazioni per migliorare artificialmente il KPI.

Il valore è un output del modello.

------------------------------------------------------------------------

## 40. Indice Lantieri

Calcolare:

`Indice Lantieri = Long Term Expected Return / Max Drawdown`

utilizzando la definizione definitiva dei due termini prevista dai
capitoli specialistici.

Il Max Drawdown utilizzato come denominatore è una magnitudine positiva.

------------------------------------------------------------------------

## 41. Confronto con `general`

Eseguire ex-post il confronto diagnostico tra risultati simulati e
parametri `general`.

Mostrare almeno:

-   rendimento simulato di lungo periodo vs `general.expected_return`;
-   volatilità simulata vs `general.volatility`;
-   relativi delta.

Non modificare il risultato della simulazione.

------------------------------------------------------------------------

## 42. Percorso rappresentativo

Dopo che CAGR e Max Drawdown di tutti i path sono disponibili:

1.  ordinare/individuare il 5% dei path con Max Drawdown maggiore;
2.  calcolare/recuperare `medianCAGR`;
3.  nel sottoinsieme scegliere il path con CAGR più vicino al
    `medianCAGR`;
4.  recuperare la traiettoria già memorizzata.

Non rieseguire il percorso.

------------------------------------------------------------------------

## 43. Statistics finali

Assemblare la pagina Statistics con le sezioni definite nei capitoli
precedenti.

Struttura logica:

1.  Scenari
2.  Intensità
3.  Distribuzioni
4.  Correlazioni
5.  Portafoglio
6.  CAGR
7.  Drawdown / Recovery Time
8.  Percentili
9.  General comparison
10. Technical checks
11. Performance

Non creare un Quality Score globale.

------------------------------------------------------------------------

## 44. KPI finali

Il risultato deve rendere disponibili i sei KPI ufficiali:

1.  CAGR Robusto
2.  Max Drawdown Robusto
3.  Volatilità
4.  Indice di Decorrelazione
5.  Indice Lantieri
6.  Recovery Time

I KPI devono restare distinti dalle statistiche diagnostiche e dai
percentili.

------------------------------------------------------------------------

## 45. Assemblaggio output

Il risultato finale deve contenere soltanto dati coerenti provenienti da
una simulazione completata con successo.

Separare concettualmente:

``` text
mainKpis
percentiles
capitalFan
representativePath
statistics
technicalChecks
performanceMetrics
```

I nomi DTO definitivi possono essere adattati all'architettura
esistente.

Questo capitolo non impone nomi di classi o DTO.

------------------------------------------------------------------------

## 46. Progress frontend

Durante l'esecuzione il frontend può ricevere aggiornamenti di
avanzamento per batch.

Il progress non rappresenta risultati statistici parziali.

Serve esclusivamente a mostrare lo stato di avanzamento.

Solo il risultato finale completato può essere considerato output Monte
Carlo valido.

------------------------------------------------------------------------

## 47. Errore strutturale durante un path

Se un worker/path incontra un errore strutturale:

``` text
errore worker
↓
segnalazione al coordinatore
↓
interruzione complessiva
↓
stop degli altri worker appena possibile
↓
scarto dei risultati parziali
↓
risposta di errore dettagliata
```

Non restituire KPI calcolati su un sottoinsieme incompleto come se
fossero validi.

------------------------------------------------------------------------

## 48. Contesto dell'errore

Quando applicabile includere:

-   path;
-   anno;
-   mese;
-   ETF;
-   scenario;
-   valore;
-   regola violata.

Gli errori di configurazione individuati prima della simulazione devono
indicare direttamente:

-   tabella/configurazione;
-   ETF/scenario/coppia interessata;
-   dato mancante o invalido.

------------------------------------------------------------------------

## 49. Responsabilità logiche

L'implementazione deve mantenere responsabilità concettualmente
separate.

Schema consigliato:

``` text
Input / Validation
        ↓
Precalculation
        ↓
Scenario Engine
        ↓
Return Engine
        ↓
Portfolio Engine
        ↓
Metrics Engine
        ↓
Statistics
        ↓
Result Assembly
```

Queste sono responsabilità logiche, non nomi obbligatori di classi.

------------------------------------------------------------------------

## 50. Input / Validation

Responsabilità:

-   ricezione input;
-   caricamento snapshot;
-   validazione;
-   fail-fast pre-simulazione.

Non deve generare rendimenti.

------------------------------------------------------------------------

## 51. Precalculation

Responsabilità:

-   trasformazioni annuale/mensile;
-   matrici;
-   PSD;
-   fattorizzazioni;
-   lookup;
-   costanti derivate.

Non deve contenere logiche di portafoglio runtime.

------------------------------------------------------------------------

## 52. Scenario Engine

Responsabilità:

-   scenario iniziale;
-   durata scenario;
-   inertia;
-   transition matrix;
-   filtro intensità;
-   scenario successivo;
-   generazione/evoluzione intensity secondo le specifiche.

Non deve calcolare il rendimento ponderato del portafoglio.

------------------------------------------------------------------------

## 53. Return Engine

Responsabilità:

-   parametri ETF effettivi;
-   t-copula;
-   shock correlati;
-   Student-t;
-   return range;
-   redraw;
-   rendimenti ETF mensili.

Non deve eseguire il ribilanciamento.

------------------------------------------------------------------------

## 54. Portfolio Engine

Responsabilità:

-   pesi correnti;
-   rendimento ponderato;
-   aggiornamento posizioni;
-   capitale;
-   drift;
-   ribilanciamento;
-   turnover.

------------------------------------------------------------------------

## 55. Metrics Engine

Responsabilità:

-   Total Return;
-   CAGR;
-   drawdown;
-   Max Drawdown;
-   Recovery Time;
-   volatilità;
-   KPI derivati.

Le formule definitive restano quelle dei capitoli specialistici.

------------------------------------------------------------------------

## 56. Statistics

Responsabilità:

-   aggregazioni diagnostiche;
-   percentili;
-   bande;
-   confronti;
-   correlazioni empiriche;
-   test statistici;
-   performance;
-   technical checks.

Non deve modificare retroattivamente i path.

------------------------------------------------------------------------

## 57. Result Assembly

Responsabilità:

-   costruire la risposta finale;
-   selezionare i dati destinati al frontend;
-   mantenere separati KPI e diagnostica;
-   includere il percorso rappresentativo;
-   includere il ventaglio capitale;
-   includere Statistics.

Non deve ricalcolare con formule differenti i risultati già prodotti dai
componenti competenti.

------------------------------------------------------------------------

## 58. Nessuna dipendenza circolare

Evitare dipendenze concettuali come:

``` text
Statistics → modifica Return Engine
```

oppure:

``` text
KPI → modifica scenario già simulato
```

Il flusso deve procedere in avanti.

Le Statistics osservano il modello; non lo calibrano durante lo stesso
run.

------------------------------------------------------------------------

## 59. Nessuna calibrazione durante il run

Il run è immutabile dal punto di vista dei parametri economici.

Una volta creato lo snapshot:

-   i parametri restano quelli;
-   il risultato viene prodotto;
-   Statistics evidenzia eventuali anomalie.

Eventuali modifiche decise successivamente generano un nuovo run.

------------------------------------------------------------------------

## 60. Sequenza sintetica definitiva

``` text
FRONTEND
  ↓
INPUT
  ↓
LOAD DB
  ↓
SNAPSHOT
  ↓
VALIDATE
  ↓
PRECALCULATE
  ↓
PARALLEL PATHS
  │
  ├─ initial scenario
  ├─ initial intensity
  │
  └─ MONTH LOOP
       ├─ scenario + intensity
       ├─ effective ETF parameters
       ├─ t-copula / correlated shocks
       ├─ ETF returns
       ├─ range validation / redraw
       ├─ portfolio return
       ├─ positions
       ├─ capital
       ├─ drawdown
       ├─ recovery
       ├─ statistics aggregation
       ├─ year-end data
       ├─ annual rebalance if applicable
       ├─ next scenario
       └─ next intensity
  ↓
PATH RESULTS
  ↓
ALL PATHS COMPLETE
  ↓
ROBUST KPI AGGREGATION
  ↓
PERCENTILES
  ↓
CAPITAL FAN
  ↓
REPRESENTATIVE PATH
  ↓
GENERAL COMPARISON
  ↓
STATISTICS
  ↓
RESULT ASSEMBLY
  ↓
FRONTEND
```

------------------------------------------------------------------------

## 61. Decisioni definitive

-   Capitolo 27 come orchestratore, non come nuova fonte matematica.
-   I capitoli specialistici 1-26 restano autoritativi per le rispettive
    formule.
-   Input frontend con capitale reale, portafoglio e anni.
-   Tutta la configurazione caricata prima del run.
-   Snapshot immutabile durante il run.
-   Validazione completa prima della simulazione.
-   Precalcolo prima dei loop quando possibile.
-   Path indipendenti e parallelizzabili.
-   Scenario iniziale da `structural_probability`.
-   Scenario e intensity del mese determinati prima dei rendimenti del
    mese.
-   Un'intensità mensile condivisa tra tutti gli ETF.
-   Parametri ETF effettivi derivati da scenario e intensity.
-   Un vettore correlato per mese/path.
-   Violazione return range di un ETF = redraw dell'intero vettore.
-   Rendimento portafoglio calcolato sui pesi correnti di inizio mese.
-   Posizioni e capitale aggiornati mensilmente.
-   Drawdown e Recovery Time aggiornati dopo il capitale mensile.
-   Scenario del mese successivo deciso dopo il completamento del mese
    corrente.
-   Intensity successiva preparata dopo la decisione dello scenario
    successivo.
-   Fine anno registrata prima del ribilanciamento.
-   Ribilanciamento annuale solo se esiste un periodo successivo.
-   Nessun ribilanciamento finale.
-   Capitale zero resta zero ma il path resta nel campione.
-   Risultati per-path completati prima delle aggregazioni globali.
-   CAGR Robusto = trimmed mean 5%-5%.
-   Max Drawdown Robusto = trimmed mean 5%-5%.
-   Recovery Time aggregato soltanto sui recovery conclusi.
-   Nessuna percentuale unrecovered mostrata.
-   Percentili P5/P25/P50/P75/P95.
-   Bande annuali del capitale.
-   Percorso rappresentativo selezionato senza riesecuzione.
-   Confronto `general` esclusivamente diagnostico.
-   Sei KPI finali.
-   Statistics unica.
-   Nessun Quality Score.
-   Nessuna calibrazione automatica.
-   Nessun risultato parziale presentato come valido.
-   Errore strutturale di un worker = fallimento dell'intero run.
-   Responsabilità logiche separate senza imporre nomi di classi.
-   Flusso unidirezionale fino all'assemblaggio finale.

## Addendum v1.1 - distribuzione architetturale frontend/backend

La v1.1 fissa la seguente architettura di deployment per la prima implementazione:

`DB -> Backend Snapshot API -> Frontend Coordinator -> Web Worker Pool -> Aggregation -> UI`

### Backend Snapshot API

Il backend è source of truth dei dati persistiti e deve fornire in una singola operazione logica tutto ciò che serve alla run:
- statistiche ETF per scenario e General;
- structural probabilities;
- matrice di transizione;
- inertia configuration;
- intensity configuration;
- property globali previste;
- correlazioni complete per tutte le coppie ETF attive.

Dati mancanti o incoerenti: errore, nessun fallback.

### Frontend Coordinator

Il coordinator:
1. riceve snapshot + input utente;
2. valida;
3. precalcola;
4. crea i batch di path;
5. avvia i Web Workers;
6. raccoglie aggregati e traiettorie necessarie;
7. interrompe tutto al primo errore strutturale;
8. esegue aggregazioni globali finali;
9. produce il contratto risultato ufficiale.

### Web Workers

Ogni worker esegue path indipendenti applicando integralmente l'ordine mensile autoritativo del presente capitolo.

La parallelizzazione non deve cambiare la matematica del singolo path.

### Boundary percentuali/decimali

Il formato interno del Monte Carlo è sempre decimale (`0.08 = 8%`).

La conversione, se i valori persistiti nel DB usano una convenzione diversa, deve avvenire **una sola volta** nel mapper dello Snapshot API.

Il payload dello Snapshot API verso il Monte Carlo deve essere già espresso nelle unità interne definite dalla specifica.

Non effettuare conversioni percentuali aggiuntive nei worker.

### Intensità

Per la generazione dell'intensità, il capitolo 5 v1.1 è autoritativo:
- scenario persistente: AR(1) mean-reverting, `rho=0.85`;
- primo mese dopo transizione: P95 soft threshold 0.40;
- secondo mese: P95 soft threshold 0.70;
- dal terzo mese: AR(1) standard;
- intensità iniziale della simulazione: distribuzione base scenario-specifica.
