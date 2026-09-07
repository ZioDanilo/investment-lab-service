# Addendum v1.2 — KPI Volatilità e libertà implementative

## 1. Scopo

Questo addendum integra la **Monte Carlo Engine Specification v1.1** e chiude gli ultimi punti emersi dall'analisi pre-implementazione.

In caso di contrasto con formulazioni precedenti, questo addendum è autoritativo esclusivamente per gli argomenti trattati qui.

---

## 2. KPI Volatilità — definizione definitiva

La **Volatilità** è uno dei sei KPI principali del motore Monte Carlo.

### 2.1 Volatilità per singolo path

Per ogni path `p`, utilizzare l'intera serie dei rendimenti mensili del portafoglio:

`R_p,1 ... R_p,T`

dove:

`T = years * 12`

Calcolare la **sample standard deviation** dei rendimenti mensili:

`monthlyVolatility_p = sampleStdDev(R_p,1 ... R_p,T)`

La sample standard deviation usa denominatore:

`T - 1`

Annualizzare quindi:

`annualizedVolatility_p = monthlyVolatility_p * sqrt(12)`

Non utilizzare rendimenti annuali per il calcolo della volatilità per-path.

Non calcolare la volatilità sui livelli di capitale.

Non aggregare preventivamente i rendimenti di path differenti.

### 2.2 KPI aggregato

Dopo aver ottenuto una volatilità annualizzata per ciascun path:

`annualizedVolatility_1 ... annualizedVolatility_N`

ordinare i valori ed eliminare:
- il 5% più basso;
- il 5% più alto.

Il KPI definitivo è:

`VolatilityKpi = trimmedMean5%-5%(annualizedVolatility_1 ... annualizedVolatility_N)`

Quindi:

**Volatilità KPI = trimmed mean 5%-5% delle volatilità annualizzate per-path.**

Il calcolo deve utilizzare valori non arrotondati. L'arrotondamento è consentito esclusivamente nella presentazione frontend.

### 2.3 Casi limite

- Ogni path completo contiene normalmente almeno 12 osservazioni mensili per anno di orizzonte e quindi la sample standard deviation è definita.
- Un path che raggiunge capitale zero continua fino alla fine secondo le regole già definite; i rendimenti mensili successivi coerenti con lo stato zero restano parte della serie del path.
- La volatilità di tali path partecipa normalmente all'aggregazione e al trimming.
- Valori `NaN`, `Infinity` o serie insufficienti per calcolare la sample standard deviation costituiscono errore strutturale.

---

## 3. Coerenza dei KPI robusti

Per la v1.2 i KPI robusti basati su distribuzioni per-path seguono la stessa logica di aggregazione:

- **CAGR Robusto** → trimmed mean 5%-5% dei CAGR per-path;
- **Max Drawdown Robusto** → trimmed mean 5%-5% dei Max Drawdown positivi per-path;
- **Volatilità** → trimmed mean 5%-5% delle volatilità annualizzate per-path;
- **Recovery Time** → trimmed mean 5%-5% dei Recovery Time per-path completati.

Questa uniformità è intenzionale.

Le formule dell'Indice di Decorrelazione e dell'Indice Lantieri restano quelle definite nei rispettivi capitoli della specifica e non vengono modificate da questo addendum.

---

## 4. Schema persistente DB — libertà implementativa

La specifica definisce **quali dati devono esistere**, la loro semantica, le unità e le validazioni richieste.

Non prescrive:
- nomi delle nuove tabelle;
- nomi fisici delle colonne;
- organizzazione repository/service;
- chiavi surrogate;
- convenzioni Sequelize;
- struttura delle migration oltre ai vincoli funzionali richiesti.

Il coding agent può progettare lo schema persistente adattandolo all'architettura DB esistente.

### Vincoli obbligatori

Lo schema scelto MUST:
- rappresentare integralmente tutti i dati richiesti dalla specifica;
- impedire o rilevare configurazioni duplicate/ambigue;
- permettere allo Snapshot API di verificare la completezza;
- preservare la semantica scenario-specifica;
- non introdurre fallback impliciti.

Il formato interno ricevuto dal Monte Carlo resta sempre decimale:

`0.08 = 8%`

Se il DB utilizza una convenzione differente, la conversione avviene una sola volta nel mapper dello Snapshot API, come già stabilito dalla v1.1.

---

## 5. Protocollo Web Worker — libertà implementativa

La struttura concreta dei messaggi tra Angular coordinator e Web Workers è una decisione tecnica dell'implementazione.

Il coding agent può definire liberamente:
- nomi dei message type;
- DTO interni;
- dimensione e struttura dei batch;
- protocollo di progress;
- protocollo di cancel;
- protocollo result/error;
- strategia di merge degli aggregati locali.

### Vincoli obbligatori

L'implementazione MUST rispettare:

1. il loop Monte Carlo non gira sul main thread Angular;
2. i path sono indipendenti;
3. il numero di worker è determinato automaticamente e non è una property utente;
4. nessun seed è esposto, richiesto o salvato;
5. il progresso non modifica la simulazione;
6. l'annullamento non produce un risultato parziale considerato valido;
7. un errore strutturale in un worker invalida l'intera run;
8. il coordinator interrompe gli altri worker dopo un errore strutturale;
9. la parallelizzazione non modifica formule, ordine mensile o distribuzioni;
10. nessun worker interroga direttamente il database.

---

## 6. Student-t, CDF e inverse CDF — libertà numerica controllata

La specifica prescrive la matematica, non una particolare libreria numerica.

Il coding agent può:
- utilizzare una libreria numerica affidabile compatibile con il progetto;
- oppure implementare direttamente Student-t CDF, inverse CDF e funzioni correlate.

Non può sostituire Student-t o t-copula con distribuzioni differenti per semplificare l'implementazione.

### Vincoli obbligatori

L'implementazione MUST rispettare:
- Student-t marginale `ν = 5`;
- t-copula `ν = 5`;
- standardizzazione prevista dalla specifica;
- clamp numerico delle probabilità secondo l'epsilon già definito;
- monotonicità della CDF e della inverse CDF;
- stabilità nelle code rilevanti;
- assenza di fallback silenziosi verso una normale.

### Test numerici

Devono essere presenti test automatici almeno per:
- `CDF(inverseCDF(p)) ≈ p` su una griglia di probabilità che includa centro e code;
- simmetria della Student-t;
- quantili noti o confrontati con una reference implementation affidabile;
- media campionaria circa zero dello shock standardizzato;
- varianza campionaria circa uno dello shock standardizzato;
- comportamento finito e valido vicino al clamp epsilon utilizzato dalla copula.

Le tolleranze numeriche dei test possono essere scelte tecnicamente in funzione dell'algoritmo/libreria, ma devono essere motivate dal livello di accuratezza della reference e non utilizzate per nascondere errori sistematici.

---

## 7. Effetto sul piano di implementazione

Con questo addendum non risultano ulteriori decisioni quantitative bloccanti note prima dell'avvio dell'implementazione.

Il coding agent può procedere per step secondo la v1.1, utilizzando questo addendum come integrazione autoritativa.

Se durante l'implementazione emerge un conflitto non risolvibile mediante la gerarchia della specifica, il coding agent MUST segnalarlo invece di inventare un comportamento.

---

## 8. Precedenza

Per gli argomenti trattati:

`Addendum v1.2 > v1.1 > capitolo specialistico precedente`

Per tutti gli altri argomenti resta valida integralmente la gerarchia definita in:

`00-monte-carlo-engine-specification.md`
