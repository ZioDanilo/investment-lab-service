# 09-distribuzione-dei-rendimenti

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

---

# 1. Scopo

Questo capitolo definisce la distribuzione utilizzata per generare lo shock casuale mensile dei rendimenti degli ETF.

La distribuzione scelta deve:

- essere più realistica di una normale pura nella rappresentazione delle code;
- mantenere la volatilità determinata dal modello;
- essere semplice da comprendere e verificare;
- non introdurre nuove configurazioni DB non necessarie;
- integrarsi con scenario, intensità, return range e correlazioni.

---

# 2. Distribuzione scelta

La distribuzione scelta per lo shock casuale è una:

**Student-t standardizzata**

con:

`degreesOfFreedom = 5`

Il valore:

`ν = 5`

è definito direttamente nel codice.

Non deve essere aggiunta una property DB dedicata.

La stessa Student-t viene utilizzata:

- per tutti gli ETF;
- per tutti i macro-scenari;
- per tutti i mesi.

Le differenze di comportamento tra ETF e scenari derivano da:

- expected return;
- volatility;
- intensity;
- return range;
- correlazioni.

---

# 3. Motivazione della scelta

Una distribuzione normale tende a sottostimare la probabilità di eventi estremi.

La Student-t con `ν = 5` produce code più pesanti e quindi una maggiore frequenza di shock rilevanti.

Questa scelta rende la simulazione più prudente senza introdurre una struttura eccessivamente complessa.

Il motore dispone già di altri meccanismi che differenziano il rischio:

- macro-scenario;
- intensità;
- volatilità specifica dello scenario;
- return range.

Per questo motivo non vengono utilizzati gradi di libertà diversi per ETF o scenario.

---

# 4. Student-t e volatilità

La Student-t standard con `ν = 5` non ha deviazione standard pari a 1.

Per evitare di alterare la volatility configurata nel modello, lo shock deve essere standardizzato.

Per una Student-t con:

`ν > 2`

la varianza è:

`ν / (ν - 2)`

Lo shock standardizzato deve quindi essere:

`standardizedShock = rawStudentT * sqrt((ν - 2) / ν)`

Con:

`ν = 5`

si ottiene:

`standardizedShock = rawStudentT * sqrt(3 / 5)`

Lo shock risultante ha:

- media teorica = 0;
- deviazione standard teorica = 1.

Questa standardizzazione è obbligatoria.

---

# 5. Formula concettuale del rendimento mensile

Dopo aver determinato:

- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`;

il rendimento mensile viene generato concettualmente come:

`monthlyReturn = effectiveMonthlyExpectedReturn + effectiveMonthlyVolatility * standardizedShock`

dove:

`standardizedShock`

è estratto dalla Student-t standardizzata con `ν = 5`.

---

# 6. Ruolo dello scenario

Lo scenario non modifica la forma della Student-t.

Lo scenario determina invece:

- expected return annuale;
- volatility annuale;
- return range annuale;
- matrice di correlazione applicabile.

Questi parametri vengono trasformati e applicati secondo i capitoli precedenti.

---

# 7. Ruolo dell'intensità

L'intensità non modifica `ν`.

L'intensità modifica invece:

- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`.

La Student-t rimane la distribuzione standardizzata dello shock.

La formula con cui l'intensità modifica expected return e volatility è definita nel capitolo dedicato al ruolo dell'intensità.

---

# 8. Return range

Il return range mensile effettivo è derivato secondo le regole del capitolo 08.

Per ogni mese devono essere disponibili:

- `effectiveMonthlyRangeMin`;
- `effectiveMonthlyRangeMax`.

Dopo aver generato il rendimento:

`monthlyReturn`

verificare:

`effectiveMonthlyRangeMin <= monthlyReturn <= effectiveMonthlyRangeMax`

---

# 9. Reject & Redraw

Se il rendimento estratto è fuori dal range mensile effettivo:

- scartare l'estrazione;
- generare un nuovo shock Student-t;
- ricalcolare il rendimento;
- ripetere il controllo.

Non utilizzare clamp.

Non correggere il rendimento verso il limite.

---

# 10. Limite tecnico ai redraw

Per evitare loop infiniti in caso di configurazioni patologiche:

`MAX_REDRAW_ATTEMPTS = 1000`

Il valore è definito direttamente nel codice.

Non deve essere aggiunta una property DB.

Se dopo 1000 tentativi non viene ottenuto un rendimento valido:

- interrompere l'elaborazione del percorso;
- restituire un errore tecnico esplicito;
- identificare ETF, scenario, mese e parametri coinvolti.

Non utilizzare fallback.

---

# 11. Pseudocodice di estrazione

```text
const STUDENT_T_DF = 5
const MAX_REDRAW_ATTEMPTS = 1000

scaleFactor = sqrt((STUDENT_T_DF - 2) / STUDENT_T_DF)

FOR attempt FROM 1 TO MAX_REDRAW_ATTEMPTS:

    rawShock = drawStudentT(STUDENT_T_DF)

    standardizedShock =
        rawShock * scaleFactor

    monthlyReturn =
        effectiveMonthlyExpectedReturn
        + effectiveMonthlyVolatility
        * standardizedShock

    IF effectiveMonthlyRangeMin
       <= monthlyReturn
       <= effectiveMonthlyRangeMax:

        RETURN monthlyReturn

THROW MonteCarloDistributionError
```

---

# 12. Nessun parametro Student-t nel database

Non creare:

- `student_t_df`;
- `student_t_scale`;
- `student_t_skewness`;
- property equivalenti.

La distribuzione deve rimanere semplice e stabile.

Parametri definiti a codice:

`STUDENT_T_DF = 5`

`MAX_REDRAW_ATTEMPTS = 1000`

---

# 13. Nessuna skewness aggiuntiva

Non utilizzare una skewed Student-t nella prima versione.

L'asimmetria complessiva del motore può emergere da:

- expected return diversi per scenario;
- return range asimmetrici;
- frequenze degli scenari;
- intensità;
- correlazioni.

Non introdurre quindi un parametro di skewness aggiuntivo.

---

# 14. Nessuna miscela di distribuzioni

Non utilizzare nella prima versione:

- mixture of Gaussians;
- mixture of Student-t;
- regime distribution aggiuntive oltre ai macro-scenari;
- distribuzioni specifiche per singolo ETF.

Il macro-modello già differenzia i regimi.

La distribuzione dello shock deve restare unica.

---

# 15. Correlazioni future

La generazione descritta in questo capitolo definisce la distribuzione marginale dello shock.

Nel capitolo dedicato alle correlazioni gli shock dei diversi ETF dovranno essere resi dipendenti secondo la matrice dello scenario corrente.

La correlazione non deve modificare:

- expected return;
- volatility;
- degrees of freedom.

La soluzione tecnica potrà prevedere una copula o una trasformazione multivariata compatibile con marginali Student-t.

Questo aspetto viene rinviato al capitolo dedicato alle correlazioni.

---

# 16. Statistiche diagnostiche da raccogliere

La futura pagina Statistics dei rendimenti deve mostrare, per ETF e scenario, almeno:

- numero totale di estrazioni;
- numero totale di redraw;
- reject rate;
- media empirica;
- mediana empirica;
- volatilità empirica;
- skewness;
- kurtosis;
- minimo;
- massimo;
- P1;
- P5;
- P25;
- P75;
- P95;
- P99.

---

# 17. Frequenza degli shock estremi

Mostrare anche la frequenza empirica di shock standardizzati con:

- `|shock| > 2`;
- `|shock| > 3`;
- `|shock| > 4`.

Separare, quando utile:

- shock positivi;
- shock negativi.

Questo permette di verificare quanto le code Student-t sopravvivono dopo l'applicazione del return range.

---

# 18. Effetto del Reject & Redraw sulle code

Il sistema deve monitorare quanto il return range tronca la Student-t.

Mostrare almeno:

- reject rate totale;
- reject rate per ETF;
- reject rate per scenario;
- reject rate per fascia di intensità.

Un reject rate molto elevato può indicare:

- return range troppo stretto;
- volatility troppo elevata;
- distribuzione incoerente con i parametri DB;
- formula dell'intensità eccessivamente aggressiva.

Non correggere automaticamente il modello.

Mostrare il problema nelle Statistics.

---

# 19. Confronto Student-t teorica vs distribuzione effettiva

La validazione futura deve distinguere tre livelli:

## Livello 1 - Shock teorico

Student-t standardizzata con `ν = 5`.

## Livello 2 - Shock accettato

Student-t dopo Reject & Redraw.

## Livello 3 - Rendimento finale

Distribuzione dei rendimenti dopo:

- scenario;
- intensità;
- expected return;
- volatility;
- range;
- correlazioni.

Questo confronto serve a capire quale parte della distribuzione finale deriva da ciascun meccanismo.

---

# 20. Media e volatilità

Il sistema deve verificare statisticamente che la standardizzazione della Student-t non alteri in modo strutturale:

- media = 0 dello shock;
- deviazione standard = 1 dello shock.

Dopo l'applicazione di expected return e volatility, su campioni sufficientemente grandi e prima delle distorsioni da truncation, il comportamento empirico deve essere coerente con:

- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`.

Il Reject & Redraw può alterare leggermente media e volatility finali.

Questo effetto deve essere misurato nelle Statistics e non corretto automaticamente.

---

# 21. Generazione della Student-t

Utilizzare una funzione/libreria numerica affidabile già disponibile nel progetto o nel runtime.

Se non è disponibile una funzione Student-t diretta, implementare la generazione tramite un algoritmo matematicamente corretto.

La Student-t può essere generata concettualmente come:

`T = Z / sqrt(V / ν)`

dove:

- `Z ~ N(0,1)`;
- `V ~ ChiSquare(ν)`;
- `Z` e `V` sono indipendenti.

Non utilizzare approssimazioni arbitrarie.

---

# 22. Prestazioni

La generazione Student-t verrà eseguita un numero molto elevato di volte.

L'implementazione deve quindi:

- evitare allocazioni inutili;
- evitare oggetti temporanei nel loop principale;
- utilizzare funzioni numeriche efficienti;
- applicare il pre-calcolo del fattore di standardizzazione.

Pre-calcolare una sola volta:

`STUDENT_T_SCALE = sqrt(3 / 5)`

per `ν = 5`.

---

# 23. Errori

In caso di fallimento dei 1000 redraw restituire un errore specifico.

Esempio concettuale:

`MONTE_CARLO_RETURN_DISTRIBUTION_REJECT_LIMIT`

L'errore deve includere almeno:

- ISIN;
- scenario;
- intensità;
- effective expected return;
- effective volatility;
- effective range min;
- effective range max;
- tentativi effettuati.

---

# 24. Nessuna correzione automatica

Il servizio NON deve, in caso di reject rate elevato:

- allargare automaticamente il range;
- abbassare automaticamente la volatility;
- modificare `ν`;
- modificare expected return;
- cambiare scenario;
- cambiare intensità.

Il comportamento deve essere diagnosticato e successivamente calibrato tramite configurazioni consapevoli.

---

# 25. Decisioni definitive del capitolo

- Distribuzione dello shock: Student-t.
- Degrees of freedom: `ν = 5`.
- `ν` definito direttamente nel codice.
- Nessuna nuova property DB.
- Stesso `ν` per tutti gli ETF.
- Stesso `ν` per tutti gli scenari.
- Student-t standardizzata a media 0 e deviazione standard 1.
- Formula di standardizzazione: `T * sqrt((ν-2)/ν)`.
- Con `ν = 5`: fattore `sqrt(3/5)`.
- Expected return e volatility determinano centro e scala del rendimento.
- Scenario e intensità modificano expected return e volatility, non `ν`.
- Return range applicato dopo la generazione.
- Fuori range: Reject & Redraw.
- Nessun clamp.
- Massimo 1000 redraw.
- Superato il limite: errore tecnico.
- `MAX_REDRAW_ATTEMPTS` definito a codice.
- Nessuna skewed Student-t.
- Nessuna mixture distribution.
- Nessuna distribuzione specifica per ETF.
- Diagnostica delle code obbligatoria nelle future Statistics.
- Misurare il reject rate.
- Misurare frequenze oltre 2σ, 3σ e 4σ.
- Misurare skewness e kurtosis.
- Non correggere automaticamente eventuali divergenze statistiche.
