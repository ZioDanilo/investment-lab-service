# 26 - Performance e ottimizzazione

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

Versione: 1.0

## 1. Scopo

Definire le regole di performance e ottimizzazione del Monte Carlo
Engine senza modificare il modello matematico e statistico definito nei
capitoli precedenti.

Principio fondamentale:

> **Performance sì, approssimazioni matematiche no.**

Le ottimizzazioni devono riguardare:

-   esecuzione;
-   memoria;
-   parallelizzazione;
-   accesso ai dati;
-   precalcolo;
-   strutture interne.

Non devono alterare:

-   numero di percorsi richiesto;
-   durata della simulazione;
-   granularità mensile;
-   distribuzioni;
-   correlazioni;
-   scenari;
-   intensità;
-   KPI;
-   percentili.

------------------------------------------------------------------------

## 2. Parallelizzazione automatica

I percorsi Monte Carlo sono indipendenti e devono poter essere elaborati
in parallelo.

Il backend deve utilizzare automaticamente un livello di parallelismo
adeguato alle risorse hardware disponibili.

Non introdurre nella prima versione property utente come:

`numberOfThreads`

o equivalenti.

La gestione del parallelismo è una responsabilità tecnica del motore.

------------------------------------------------------------------------

## 3. Indipendenza dei percorsi

Ogni percorso deve mantenere il proprio stato indipendente:

-   scenario corrente;
-   durata dello scenario;
-   intensità;
-   posizioni ETF;
-   capitale;
-   running peak;
-   drawdown;
-   Recovery Time;
-   generatori casuali necessari;
-   altre variabili temporanee.

Nessuno stato mutabile di un percorso deve essere condiviso
impropriamente con altri percorsi.

------------------------------------------------------------------------

## 4. Random generator in parallelo

Evitare un unico generatore casuale globale condiviso e sincronizzato
tra tutti i worker.

Ogni worker/thread deve disporre di una sorgente casuale indipendente
adatta all'elaborazione parallela.

Non introdurre:

-   seed utente;
-   seed nel frontend;
-   seed come property;
-   seed salvato nei risultati;
-   requisito di riproducibilità.

La scelta tecnica del generatore può evolvere senza modificare il
contratto funzionale.

------------------------------------------------------------------------

## 5. Elaborazione a batch

I percorsi devono poter essere elaborati in batch.

Non costruire un unico gigantesco object graph contenente ogni
informazione mensile di ogni ETF e di ogni percorso.

Durante il calcolo mantenere soltanto i dati necessari per:

-   continuare il percorso;
-   risultati finali;
-   KPI;
-   percentili;
-   Statistics;
-   diagnostica;
-   percorso rappresentativo;
-   ventaglio annuale del capitale.

Le osservazioni temporanee non necessarie dopo l'aggregazione possono
essere eliminate.

------------------------------------------------------------------------

## 6. Traiettorie del capitale

Esiste una specifica eccezione alla politica di riduzione della memoria.

La scelta del percorso rappresentativo avviene dopo aver calcolato CAGR
e Max Drawdown di tutti i percorsi.

Poiché il progetto non utilizza seed riproducibili, non è possibile
rigenerare successivamente lo stesso percorso.

Pertanto conservare temporaneamente la traiettoria mensile del capitale
di tutti i percorsi fino alla selezione del percorso rappresentativo.

Per il test standard:

`10.000 × 50 anni × 12 mesi`

si tratta di circa 6 milioni di osservazioni, oltre agli eventuali
valori iniziali.

Con valori `double` l'ordine di grandezza della memoria grezza è circa
48 MB.

Questo costo è considerato accettabile.

------------------------------------------------------------------------

## 7. Selezione del percorso rappresentativo

Al termine della simulazione:

1.  calcolare i risultati sintetici di tutti i percorsi;
2.  individuare il 5% dei percorsi con Max Drawdown maggiore;
3.  calcolare/recuperare `medianCAGR`;
4.  nel sottoinsieme selezionare il percorso con CAGR più vicino a
    `medianCAGR`;
5.  recuperare la sua traiettoria del capitale già conservata;
6.  rendere eliminabili le traiettorie degli altri percorsi quando non
    servono più.

Non effettuare una seconda simulazione per ricostruire il percorso.

------------------------------------------------------------------------

## 8. Precalcolo

Tutto ciò che non cambia durante i loop mensili deve essere calcolato
prima possibile.

Precalcolare almeno, quando applicabile:

-   conversioni annuale → mensile;
-   parametri scenario/ETF derivati;
-   z-score derivati dal return range;
-   matrici di correlazione;
-   matrici corrette PSD;
-   fattorizzazioni;
-   target weights;
-   strutture di lookup ETF;
-   strutture di lookup scenario;
-   costanti Student-t;
-   costanti matematiche;
-   dati necessari alla copula.

Evitare di ripetere questi calcoli per ogni mese/percorso.

------------------------------------------------------------------------

## 9. Correlation matrix e fattorizzazione

Per ogni combinazione necessaria, costruzione, validazione, eventuale
correzione PSD e fattorizzazione devono avvenire prima del loop Monte
Carlo quando i dati sottostanti sono invarianti.

Il loop mensile deve riutilizzare le strutture precalcolate.

Non rifattorizzare la stessa matrice a ogni mese.

------------------------------------------------------------------------

## 10. Accesso al database

Regola tassativa:

> **Nessuna query DB dentro il loop Monte Carlo.**

Prima dell'avvio:

``` text
DB
↓
caricamento configurazione
↓
snapshot in memoria
↓
validazione completa
↓
precalcolo
↓
simulazione
```

La simulazione deve lavorare sullo snapshot validato.

------------------------------------------------------------------------

## 11. Configurazione mancante

Se una configurazione necessaria è:

-   mancante;
-   incompleta;
-   duplicata;
-   invalida;
-   incoerente;

la simulazione non deve partire.

Il fail-fast deve avvenire durante caricamento/validazione, non dopo
migliaia di mesi simulati.

Il messaggio deve identificare precisamente il dato da correggere.

------------------------------------------------------------------------

## 12. Scritture DB durante la simulazione

Non effettuare scritture DB per ogni:

-   mese;
-   percorso;
-   ETF;
-   shock;
-   intensità;
-   rendimento;
-   redraw;
-   capitale mensile.

Nella prima versione non è richiesto salvare nel DB l'intero risultato
Statistics.

I risultati possono essere mantenuti nella struttura di risposta/runtime
prevista dall'applicazione.

------------------------------------------------------------------------

## 13. Precisione numerica

Il motore matematico/statistico deve utilizzare principalmente:

`double`

Non utilizzare `BigDecimal` nei loop Monte Carlo per:

-   rendimenti;
-   volatilità;
-   correlazioni;
-   shock;
-   capitale simulato;
-   drawdown;
-   CAGR;
-   percentili.

La simulazione è un calcolo statistico, non una contabilizzazione
bancaria al centesimo.

------------------------------------------------------------------------

## 14. BigDecimal ai confini

Se l'architettura applicativa richiede `BigDecimal` per importi o DTO
finanziari, la conversione può avvenire ai confini del motore.

Flusso concettuale:

``` text
input applicativo
→ conversione in double
→ Monte Carlo
→ risultati double
→ eventuale conversione/formattazione output
```

Non effettuare conversioni continue `double ↔ BigDecimal` dentro i loop.

------------------------------------------------------------------------

## 15. Nessun arrotondamento nel motore

Non arrotondare:

-   capitale mensile;
-   rendimento;
-   peso;
-   shock;
-   drawdown;
-   CAGR;
-   percentili;

durante la simulazione.

L'arrotondamento è responsabilità dell'output/frontend.

------------------------------------------------------------------------

## 16. Aggregazioni Statistics

Le metriche Statistics devono essere aggregate progressivamente quando
possibile.

Esempi:

-   conteggi scenari;
-   durate;
-   transizioni;
-   distribuzioni intensity;
-   numero redraw;
-   reject rate;
-   performance counters.

Non conservare ogni singola osservazione quando il risultato richiesto
può essere ottenuto con un aggregatore statisticamente equivalente.

Fanno eccezione i campioni che devono essere conservati per calcoli
successivi esatti, come i valori per-path necessari a percentili/KPI e
le traiettorie del capitale richieste dal percorso rappresentativo.

------------------------------------------------------------------------

## 17. Dati per-path da conservare

Per ogni percorso conservare almeno i risultati sintetici necessari alle
elaborazioni successive, ad esempio:

-   `finalCapital`;
-   `CAGR`;
-   `maxDrawdown`;
-   `maxRecoveryTimeMonths` quando valido;
-   eventuali flag tecnici necessari;
-   dati richiesti dalla selezione del percorso rappresentativo.

Non è necessario creare una struttura persistente contenente tutti gli
shock e tutti i rendimenti mensili di ogni ETF.

------------------------------------------------------------------------

## 18. Bande annuali del capitale

Le bande P5/P25/P50/P75/P95 del capitale definite nel capitolo 24
derivano dalle traiettorie già simulate.

Non effettuare simulazioni aggiuntive.

I valori di fine anno possono essere estratti dalle traiettorie del
capitale e aggregati secondo il capitolo 24.

------------------------------------------------------------------------

## 19. Memoria temporanea

Le strutture temporanee devono avere un ciclo di vita limitato alla fase
in cui sono necessarie.

Dopo:

-   calcolo KPI;
-   calcolo percentili;
-   selezione percorso rappresentativo;
-   costruzione ventaglio annuale;
-   aggregazione Statistics;

i dati non più necessari devono poter essere rilasciati.

Non conservare copie duplicate delle stesse grandi strutture senza
necessità.

------------------------------------------------------------------------

## 20. Nessuna ottimizzazione matematica approssimata

Non migliorare le performance tramite:

-   riduzione automatica dei percorsi;
-   riduzione automatica degli anni;
-   passaggio da mensile ad annuale;
-   eliminazione delle code Student-t;
-   semplificazione della copula;
-   eliminazione dei redraw;
-   riduzione degli ETF;
-   sostituzione delle correlazioni con approssimazioni arbitrarie;
-   campionamento parziale non previsto.

Se il test richiesto è:

`10.000 × 50 × 12`

il motore deve eseguire quel test.

------------------------------------------------------------------------

## 21. Misurare prima di ottimizzare

La prima versione deve privilegiare:

1.  correttezza;
2.  chiarezza;
3.  misurabilità;
4.  performance.

Utilizzare le metriche definite nel capitolo 25 per individuare i reali
colli di bottiglia.

Non introdurre preventivamente complessità architetturale senza evidenza
di un problema prestazionale.

------------------------------------------------------------------------

## 22. Ottimizzazioni avanzate escluse dalla prima fase

Non introdurre inizialmente:

-   GPU computing;
-   distributed computing;
-   native code dedicato;
-   SIMD manuale;
-   cluster;
-   caching distribuito;
-   architetture complesse esclusivamente per performance.

Queste opzioni potranno essere valutate solo se i benchmark reali
dimostreranno che sono necessarie.

------------------------------------------------------------------------

## 23. Nessun timeout arbitrario

Non introdurre inizialmente un timeout economico arbitrario della
simulazione, ad esempio:

`simulationTimeout = 30 seconds`

Una macchina più lenta non deve rendere matematicamente invalida una
simulazione.

Eventuali timeout infrastrutturali già imposti dalla piattaforma sono un
problema separato e devono essere gestiti a livello
applicativo/infrastrutturale.

------------------------------------------------------------------------

## 24. Metriche di performance

Come definito nel capitolo 25, registrare almeno:

-   tempo totale simulazione;
-   numero percorsi;
-   numero totale mesi simulati;
-   percorsi/secondo;
-   mesi/secondo;
-   tempo costruzione/fattorizzazione matrici;
-   numero totale redraw;
-   reject rate.

Nella prima versione queste metriche sono diagnostiche.

Non associare soglie fail-fast prestazionali.

------------------------------------------------------------------------

## 25. Progress della simulazione

Durante simulazioni lunghe il backend deve poter comunicare al frontend
lo stato di avanzamento.

L'avanzamento deve essere basato sul lavoro completato, tipicamente
percorsi/batch completati rispetto al totale.

Esempio concettuale:

``` text
0%
10%
20%
...
90%
100%
```

Non è obbligatoria una granularità esatta del 10%.

L'implementazione può utilizzare aggiornamenti più frequenti o meno
frequenti purché non introducano overhead significativo.

------------------------------------------------------------------------

## 26. Progress per batch

Non inviare necessariamente un aggiornamento frontend dopo ogni singolo
percorso.

Preferire aggiornamenti per batch o a intervalli ragionevoli.

Obiettivi:

-   far capire che il motore sta lavorando;
-   evitare che l'interfaccia sembri bloccata;
-   evitare traffico/eventi inutili;
-   non rallentare significativamente la simulazione.

------------------------------------------------------------------------

## 27. Parallelismo e Statistics

Le aggregazioni condivise tra worker devono essere progettate evitando
contention inutile.

Quando conveniente:

1.  ogni worker/batch accumula statistiche locali;
2.  al termine vengono aggregate;
3.  il risultato globale viene costruito tramite merge.

Evitare lock globali ad alta frequenza dentro il loop mensile.

------------------------------------------------------------------------

## 28. Error handling in parallelo

Se un worker rileva un errore strutturale fail-fast:

-   l'esecuzione complessiva deve essere considerata fallita;
-   gli altri worker devono essere fermati appena ragionevolmente
    possibile;
-   deve essere restituito l'errore originale con il contesto utile;
-   non restituire risultati Monte Carlo parziali come se fossero
    validi.

------------------------------------------------------------------------

## 29. Coerenza con il collaudo

Ogni ottimizzazione deve continuare a superare:

-   test unitari;
-   test deterministici;
-   identità contabili;
-   smoke test;
-   test statistici pertinenti.

Una versione più veloce che modifica materialmente i risultati
matematici non è un'ottimizzazione valida.

------------------------------------------------------------------------

## 30. Benchmark

I benchmark devono essere effettuati almeno sul test completo:

`10.000 percorsi × 50 anni × 12 mesi`

e sul numero reale di ETF di un portafoglio rappresentativo.

Registrare i risultati nella Statistics/diagnostica tecnica.

Non definire ancora un tempo target obbligatorio.

------------------------------------------------------------------------

## 31. Priorità di ottimizzazione

Ordine consigliato:

1.  eliminare query DB nei loop;
2.  precalcolare strutture invarianti;
3.  evitare allocazioni inutili;
4.  ridurre copie di grandi array;
5.  utilizzare aggregazioni locali;
6.  parallelizzare i percorsi;
7.  misurare;
8.  ottimizzare soltanto i colli di bottiglia osservati.

------------------------------------------------------------------------

## 32. Decisioni definitive

-   Performance senza approssimazioni matematiche.
-   Parallelizzazione automatica dei percorsi.
-   Nessuna property `numberOfThreads`.
-   RNG indipendenti per worker/thread.
-   Nessun seed esposto o requisito di riproducibilità.
-   Elaborazione a batch.
-   Conservazione temporanea delle traiettorie mensili del capitale di
    tutti i percorsi.
-   Nessuna seconda simulazione per ricostruire il percorso
    rappresentativo.
-   Precalcolo delle strutture invarianti.
-   Matrici e fattorizzazioni riutilizzate.
-   Zero query DB dentro il loop Monte Carlo.
-   Configurazione caricata e validata prima della simulazione.
-   Nessuna scrittura DB mensile/per-path.
-   `double` come tipo numerico principale del motore.
-   `BigDecimal` eventualmente solo ai confini applicativi.
-   Nessun arrotondamento durante la simulazione.
-   Statistics aggregate progressivamente quando possibile.
-   Nessuna ottimizzazione tramite riduzione della qualità matematica.
-   Misurare prima di introdurre ottimizzazioni avanzate.
-   GPU/distribuito/native/SIMD manuale esclusi dalla prima fase.
-   Nessun timeout arbitrario della simulazione.
-   Metriche di performance diagnostiche.
-   Progress frontend per batch/intervalli ragionevoli.
-   Aggregazioni parallele progettate per minimizzare contention.
-   Un errore strutturale in un worker invalida l'intera simulazione.
-   Ogni ottimizzazione deve superare nuovamente il collaudo matematico
    e statistico.

## Addendum v1.1 - esecuzione frontend con Web Workers

La sede di esecuzione autoritativa della prima versione è il **frontend**.

### Responsabilità backend

Il backend deve:
- leggere tutti i dati necessari dal DB;
- costruire un unico snapshot completo;
- verificare completezza e coerenza strutturale del payload;
- restituire lo snapshot tramite API.

Non esegue il loop Monte Carlo nella prima versione.

### Responsabilità frontend

Il frontend deve:
- ricevere lo snapshot;
- validarlo prima della run;
- eseguire i precalcoli;
- suddividere i path in batch;
- distribuirli a Web Workers;
- unire gli aggregati locali;
- calcolare KPI, percentili, fan, representative path e Statistics.

### Main thread

Il main thread Angular NON deve contenere il loop Monte Carlo.

È responsabile soltanto di:
- input;
- avvio/annullamento;
- progress;
- ricezione risultati;
- rendering.

### Worker pool

Il numero di worker non è una property utente.

Determinarlo automaticamente dall'hardware disponibile, mantenendo almeno una capacità logica libera per la UI quando possibile.

Esempio di regola implementativa ammessa:

`workerCount = max(1, hardwareConcurrency - 1)`

con eventuale limite tecnico interno se necessario per memoria/stabilità, ma senza esposizione nel frontend.

Ogni worker usa un proprio RNG indipendente. Nessun seed viene esposto, salvato o richiesto.

### Errori

Se un worker rileva un errore strutturale:
- invia immediatamente il dettaglio al coordinator;
- il coordinator annulla gli altri worker;
- la run viene marcata failed;
- nessun output parziale viene presentato come valido.

### Dati trasferiti

Preferire snapshot e strutture precalcolate serializzabili/compatte. Evitare copie ridondanti ad ogni path.

Le traiettorie mensili necessarie alla selezione del representative path possono essere restituite per batch e conservate dal coordinator fino alla selezione finale, secondo le regole già definite in questo capitolo.
