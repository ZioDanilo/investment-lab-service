# 25 - Collaudo progressivo

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

Versione: 1.0

## 1. Scopo

Definire il processo di collaudo complessivo del Monte Carlo Engine 2.0.

Il collaudo deve distinguere chiaramente:

-   errori software e violazioni strutturali;
-   anomalie statistiche;
-   prestazioni;
-   diagnostica del modello.

Gli errori strutturali devono bloccare l'esecuzione. Le divergenze
statistiche devono invece essere rese osservabili senza calibrazione
automatica.

------------------------------------------------------------------------

## 2. Collaudo a livelli

Il collaudo viene eseguito progressivamente su tre dimensioni tecniche
fisse.

### Livello 1 - Smoke test

`100 percorsi × 10 anni × 12 mesi`

Obiettivo principale:

-   intercettare errori software;
-   verificare fail-fast;
-   verificare integrità dei dati;
-   controllare le principali invarianti matematiche;
-   ottenere rapidamente un primo report Statistics.

### Livello 2 - Test intermedio

`1.000 percorsi × 30 anni × 12 mesi`

Obiettivo:

-   verificare il comportamento del motore su un campione più ampio;
-   osservare la progressiva stabilizzazione delle distribuzioni;
-   individuare anomalie statistiche macroscopiche;
-   misurare le prestazioni su un carico intermedio.

### Livello 3 - Test completo

`10.000 percorsi × 50 anni × 12 mesi`

È il collaudo statistico completo di riferimento.

Deve utilizzare tutte le logiche definite nei capitoli precedenti.

I tre livelli sono valori tecnici fissi della Statistics.

Non introdurre property o configurazioni DB per modificarli nella prima
versione.

------------------------------------------------------------------------

## 3. Ordine del collaudo

Il flusso consigliato è:

``` text
validazione configurazione
        ↓
test unitari/deterministici
        ↓
smoke test
        ↓
test intermedio
        ↓
test completo
        ↓
analisi Statistics
```

Non utilizzare il test statistico completo come sostituto dei test
deterministici.

------------------------------------------------------------------------

## 4. Confronto con `general`

I dati `general` degli ETF devono essere utilizzati esclusivamente come
benchmark ex-post.

Confrontare almeno:

-   rendimento simulato di lungo periodo vs `general.expected_return`;
-   volatilità simulata vs `general.volatility`.

Mostrare i relativi delta.

Esempi concettuali:

`returnDelta = simulatedLongTermReturn - generalExpectedReturn`

`volatilityDelta = simulatedVolatility - generalVolatility`

Il confronto non deve:

-   modificare i rendimenti generati;
-   modificare volatility;
-   modificare scenari;
-   modificare intensità;
-   calibrare automaticamente il modello.

Una divergenza deve essere visibile nella Statistics e successivamente
valutata.

------------------------------------------------------------------------

## 5. Test deterministici

Prima del collaudo statistico devono esistere test automatici con
risultati matematicamente noti.

Includere almeno i seguenti casi.

### Rendimento zero

ETF/portafoglio con rendimento mensile zero:

`finalCapital = initialCapital`

### Rendimento fisso positivo

Con rendimento mensile costante noto, il capitale finale deve coincidere
con il valore ottenuto tramite capitalizzazione composta.

### Portafoglio 50/50

Con due ETF e pesi 50/50, il rendimento mensile del portafoglio deve
essere coerente con i rendimenti e i pesi iniziali del mese.

### Ribilanciamento

Dopo il ribilanciamento annuale:

`currentWeight_i = targetWeight_i`

entro la tolleranza numerica prevista.

Il capitale totale non deve cambiare per effetto del ribilanciamento.

### Capitale zero

Un percorso che raggiunge zero:

-   rimane a zero;
-   non viene terminato;
-   produce Max Drawdown 100%;
-   non viene resuscitato dal ribilanciamento.

### Max Drawdown noto

Utilizzare una sequenza sintetica di capitale con Max Drawdown noto e
verificare il risultato esatto.

### Recovery Time noto

Utilizzare una sequenza sintetica contenente:

-   peak;
-   discesa;
-   trough;
-   risalita;
-   recupero;

e verificare il tempo sott'acqua atteso.

### CAGR noto

Utilizzare capitale iniziale, capitale finale e durata noti e verificare
il CAGR.

### Correlazioni sintetiche

Prevedere casi controllati per verificare almeno:

-   matrice identità;
-   shock teoricamente non correlati;
-   comportamento coerente in un caso sintetico di correlazione perfetta
    o limite compatibile con l'implementazione.

------------------------------------------------------------------------

## 6. Test delle identità contabili

Durante il collaudo devono essere controllate automaticamente le
principali identità del portafoglio.

### Valore del portafoglio

`portfolioValue_t ≈ sum(positionValue_i,t)`

### Rendimento e capitale

Quando il capitale precedente è maggiore di zero:

`capital_t+1 / capital_t - 1 ≈ portfolioReturn_t`

### Compounding mensile

Il capitale ottenuto tramite applicazione sequenziale dei rendimenti
mensili deve coincidere con il capitale registrato.

### Rendimento annuale

Per ogni anno completo:

`annualReturn = product(1 + monthlyReturn_i) - 1`

e deve risultare coerente con:

`yearEndCapital / yearStartCapital - 1`

considerando correttamente il momento del ribilanciamento.

### Total Return

`totalReturn = finalCapital / initialCapital - 1`

### CAGR

Quando `finalCapital > 0`:

`1 + CAGR = (1 + totalReturn)^(1 / years)`

Le differenze devono restare entro una piccola tolleranza numerica
tecnica.

La tolleranza deve essere una costante tecnica nel codice, non una
property utente.

------------------------------------------------------------------------

## 7. Errori strutturali

Le violazioni delle identità matematiche e contabili sono errori
software/strutturali.

Devono causare fail-fast.

Esempi:

-   NaN;
-   Infinity;
-   capitale negativo;
-   pesi invalidi;
-   somma pesi incompatibile con 1 oltre la tolleranza;
-   probabilità invalide;
-   correlazioni invalide;
-   matrici non gestibili secondo i capitoli precedenti;
-   incoerenza capitale/posizioni;
-   incoerenza rendimento/capitale;
-   CAGR matematicamente impossibile;
-   Max Drawdown fuori range;
-   intensity fuori range;
-   superamento del massimo numero di redraw.

L'errore deve essere puntuale e risolvibile.

------------------------------------------------------------------------

## 8. Contesto degli errori

Quando applicabile, il messaggio di errore deve indicare almeno:

-   percorso;
-   anno;
-   mese;
-   ETF;
-   scenario;
-   valore problematico;
-   regola violata.

Non è necessario includere campi non pertinenti all'errore specifico.

Evitare messaggi generici come:

`Monte Carlo error`

quando è disponibile un contesto più preciso.

------------------------------------------------------------------------

## 9. Controlli statistici

I controlli statistici non devono normalmente causare fail-fast.

Devono essere osservati almeno:

-   frequenze degli scenari;
-   durata degli scenari;
-   transizioni;
-   intensità;
-   expected return empirico;
-   volatility empirica;
-   Student-t e code;
-   reject rate;
-   correlazioni empiriche;
-   CAGR;
-   confronto con `general`;
-   Max Drawdown;
-   Recovery Time;
-   percentili;
-   distribuzione del capitale finale.

Un risultato statisticamente inatteso deve essere mostrato nella
Statistics.

Non deve essere automaticamente corretto.

------------------------------------------------------------------------

## 10. Anomalia statistica vs errore software

Distinguere sempre:

### Errore software/strutturale

Esempio:

`portfolioValue != sum(positionValues)`

oltre la tolleranza.

Azione:

`FAIL`

### Anomalia statistica

Esempio:

volatilità empirica sensibilmente diversa dal benchmark.

Azione:

`REPORT`

La prima versione non deve introdurre soglie economiche arbitrarie che
trasformino automaticamente anomalie statistiche in errori.

------------------------------------------------------------------------

## 11. Statistics unica

Non creare una nuova pagina dedicata esclusivamente al capitolo 25.

Utilizzare la pagina Statistics già prevista.

Organizzare le informazioni almeno nelle seguenti sezioni logiche:

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

La struttura grafica può evolvere senza modificare il contratto
matematico.

------------------------------------------------------------------------

## 12. Technical checks

La sezione Technical checks deve mostrare sinteticamente l'esito delle
verifiche strutturali.

Esempi:

-   validazione input;
-   matrici;
-   pesi;
-   compounding;
-   capitale vs posizioni;
-   rendimento vs capitale;
-   ribilanciamento;
-   Total Return;
-   CAGR;
-   Max Drawdown;
-   Recovery Time;
-   percentili.

Non è necessario mostrare milioni di controlli riusciti individualmente.

Utilizzare aggregati e dettagliare il singolo caso quando si verifica un
errore.

------------------------------------------------------------------------

## 13. Performance

Registrare almeno:

-   tempo totale della simulazione;
-   numero di percorsi;
-   numero totale di mesi simulati;
-   percorsi al secondo;
-   mesi simulati al secondo;
-   tempo di costruzione/fattorizzazione delle matrici;
-   numero totale di redraw;
-   reject rate.

Queste metriche sono inizialmente diagnostiche.

Non definire ancora:

-   tempo massimo accettabile;
-   numero minimo di percorsi al secondo;
-   soglie prestazionali fail-fast.

Le soglie potranno essere introdotte dopo le prime esecuzioni reali.

------------------------------------------------------------------------

## 14. Logging

Evitare log dettagliati per ogni:

-   mese;
-   ETF;
-   percorso;
-   shock;
-   rendimento.

Un logging indiscriminato renderebbe il collaudo più lento e produrrebbe
volumi inutili.

Registrare invece:

-   errori strutturali;
-   contesto necessario a riprodurre logicamente il problema;
-   aggregati diagnostici;
-   metriche di performance.

Non è richiesta la riproducibilità tramite seed.

------------------------------------------------------------------------

## 15. Nessun Quality Score globale

Non creare un punteggio sintetico del tipo:

`Monte Carlo Quality Score = 87/100`

La qualità del modello deve essere valutabile osservando separatamente:

-   scenari;
-   distribuzioni;
-   correlazioni;
-   KPI;
-   benchmark;
-   controlli tecnici;
-   performance.

Un singolo score rischierebbe di nascondere anomalie rilevanti.

------------------------------------------------------------------------

## 16. Test unitari

Le invarianti matematiche verificabili definite nei capitoli precedenti
devono essere coperte da test unitari/backend automatici.

Includere almeno:

-   conversione annuale/mensile;
-   Student-t standardizzata;
-   intensità;
-   return range;
-   pesi;
-   matrici di correlazione;
-   PSD/correzione;
-   generazione shock correlati;
-   copula;
-   rendimento ponderato;
-   drift dei pesi;
-   ribilanciamento;
-   interesse composto;
-   capitale;
-   Max Drawdown;
-   Recovery Time;
-   CAGR;
-   percentili.

Non è necessario trasformare ogni frase della documentazione in un test.

Devono essere testate le regole matematiche e le invarianti che possono
essere verificate automaticamente.

------------------------------------------------------------------------

## 17. Collaudo progressivo obbligatorio

Durante lo sviluppo, quando una modifica significativa interessa il
motore:

1.  eseguire i test unitari pertinenti;
2.  eseguire lo smoke test;
3.  se superato, eseguire il test intermedio quando necessario;
4.  utilizzare il test completo per la validazione statistica
    significativa.

Non utilizzare sistematicamente 10.000 × 50 anni per ogni piccola
modifica software se un test più piccolo è sufficiente a individuare
l'errore.

------------------------------------------------------------------------

## 18. Nessuna calibrazione automatica

Il collaudo non deve modificare automaticamente:

-   expected return;
-   volatility;
-   return range;
-   correlazioni;
-   transition matrix;
-   inertia;
-   intensity;
-   Student-t;
-   gradi di libertà;
-   parametri `general`;
-   altri parametri economici.

Il flusso è:

``` text
simula
→ misura
→ mostra
→ analizza
→ eventuale decisione umana di calibrazione
```

------------------------------------------------------------------------

## 19. Output machine-readable

Oltre alla visualizzazione Statistics, i risultati del collaudo devono
essere disponibili in una struttura machine-readable per facilitare:

-   debug;
-   test automatici;
-   confronto tra versioni;
-   futura esportazione.

Separare concettualmente:

-   `technicalChecks`;
-   `statisticalDiagnostics`;
-   `performanceMetrics`.

Non è necessario definire in questo capitolo il DTO/API definitivo.

------------------------------------------------------------------------

## 20. Decisioni definitive

-   Collaudo progressivo a tre livelli.
-   Smoke: 100 percorsi × 10 anni.
-   Intermedio: 1.000 percorsi × 30 anni.
-   Completo: 10.000 percorsi × 50 anni.
-   Valori tecnici fissi, senza nuove property.
-   `general` usato solo come benchmark ex-post.
-   Nessuna calibrazione automatica.
-   Test deterministici prima dei test statistici.
-   Identità contabili e matematiche verificate automaticamente.
-   Errori strutturali in fail-fast.
-   Anomalie statistiche solo diagnostiche.
-   Messaggi di errore puntuali e contestualizzati.
-   Una sola pagina Statistics.
-   Nessun Quality Score globale.
-   Performance misurate senza soglie iniziali.
-   Logging aggregato, non per ogni osservazione.
-   Test unitari sulle principali invarianti dei capitoli precedenti.
-   Output del collaudo disponibile anche in forma machine-readable.
-   Nessun seed e nessun requisito di riproducibilità.
