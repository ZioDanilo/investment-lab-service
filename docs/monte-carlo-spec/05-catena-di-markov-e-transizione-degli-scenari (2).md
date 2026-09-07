# 05-catena-di-markov-e-transizione-degli-scenari

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.1

## 1. Scopo

Definire la logica mensile di permanenza e transizione tra:

-   `expansion`
-   `soft_landing`
-   `recession`
-   `stagflation`

Il primo mese viene estratto da `structural_probability`; dal mese
successivo si applicano le regole di questo capitolo.

Il capitolo definisce inoltre l'integrazione tra:

-   catena di Markov;
-   inerzia dello scenario;
-   intensità dello scenario;
-   memoria mensile dell'intensità.

La formula dettagliata con cui l'intensità modifica i rendimenti degli
ETF sarà definita nel capitolo dedicato alla generazione dei rendimenti.

------------------------------------------------------------------------

## 2. Transition matrix

La tabella DB `transition_matrix` contiene 16 righe con:

-   `from_scenario`
-   `to_scenario`
-   `probability`

Le probabilità sono MENSILI.

Tutte le 16 transizioni sono ammesse se configurate.

La matrice rappresenta la probabilità strutturale di base delle
transizioni e NON incorpora l'inerzia.

------------------------------------------------------------------------

## 3. Tabella di inerzia

Creare una tabella con una riga per scenario e cinque parametri:

  -----------------------------------------------------------------------------------------------------------
  scenario         entry_probability   persistence_probability   entry_months   exit_start_month   exit_decay
  -------------- ------------------- ------------------------- -------------- ------------------ ------------
  expansion                     0.90                      0.40              3                  6         0.15

  soft_landing                  0.90                      0.40              3                  6         0.15

  recession                     0.90                      0.40              3                  6         0.15

  stagflation                   0.90                      0.40              3                  6         0.15
  -----------------------------------------------------------------------------------------------------------

Nessun valore deve essere hardcoded.

### 3.1 entry_probability

Nei primi `entry_months` rappresenta la probabilità autonoma di restare
nello scenario senza interrogare la matrice.

Esempio con `0.90`:

-   90% probabilità di permanenza automatica;
-   10% probabilità di passare alla valutazione tramite
    `transition_matrix`.

### 3.2 entry_months

Configurazione iniziale:

`entry_months = 3`

I mesi 1, 2 e 3 del nuovo regime appartengono alla fase ENTRY.

A ogni cambio scenario:

`monthsInCurrentScenario = 1`

### 3.3 persistence_probability

Terminata la fase ENTRY, rappresenta la probabilità autonoma di
permanenza nello scenario.

Configurazione iniziale:

`persistence_probability = 0.40`

Se l'estrazione di persistenza non trattiene il regime, viene consultata
la `transition_matrix`.

### 3.4 exit_start_month

Configurazione iniziale:

`exit_start_month = 6`

Da questo mese inizia il decadimento progressivo della protezione
artificiale fornita dalla persistenza.

### 3.5 exit_decay

Configurazione iniziale:

`exit_decay = 0.15`

La persistence effettiva viene ridotta progressivamente:

`effectivePersistence = max(0, persistence_probability - exit_decay * exitSteps)`

dove:

`exitSteps = monthsInCurrentScenario - exit_start_month + 1`

Non esiste alcuna `exit_probability`.

------------------------------------------------------------------------

## 4. Fasi del regime

### ENTRY

Condizione:

`monthsInCurrentScenario <= entry_months`

Usare:

`entry_probability`

### PERSISTENCE

Dopo ENTRY e prima di EXIT usare:

`persistence_probability`

Il valore resta costante.

### EXIT

Da `exit_start_month` in poi utilizzare `effectivePersistence`.

La protezione artificiale diminuisce progressivamente.

Quando `effectivePersistence = 0`, la decisione è affidata integralmente
alla `transition_matrix`.

------------------------------------------------------------------------

## 5. Principio di separazione tra inerzia e Markov

L'inerzia NON modifica le probabilità memorizzate nella
`transition_matrix`.

Flusso logico:

`inerzia -> eventuale permanenza automatica`

oppure:

`inerzia fallita -> transition_matrix -> estrazione`

La `transition_matrix` può estrarre nuovamente lo scenario corrente.

Questo comportamento è intenzionale.

------------------------------------------------------------------------

## 6. Filtro dell'intensità sulla transizione

Creare property globale:

`scenario_transition_intensity_threshold = 0.60`

Se:

`currentIntensity > scenario_transition_intensity_threshold`

allora:

`nextScenario = currentScenario`

In questo caso:

-   non viene eseguita l'estrazione di inerzia;
-   non viene consultata la `transition_matrix`;
-   lo scenario permane automaticamente.

Se:

`currentIntensity <= scenario_transition_intensity_threshold`

si applica normalmente:

1.  inerzia;
2.  eventuale `transition_matrix`.

------------------------------------------------------------------------

## 7. Nuova tabella dedicata all'intensità

La configurazione statistica dell'intensità deve essere separata dalla
tabella di inerzia.

Creare una nuova tabella:

`scenario_intensity_config`

con una riga per ciascun macro scenario.

Campi minimi:

  scenario         mean_intensity   std_dev_intensity
  -------------- ---------------- -------------------
  expansion         configurabile       configurabile
  soft_landing      configurabile       configurabile
  recession         configurabile       configurabile
  stagflation       configurabile       configurabile

I valori numerici definitivi di media e deviazione standard saranno
configurati successivamente sulla base dell'analisi quantitativa dei
quattro regimi.

Nessun valore deve essere hardcoded.

------------------------------------------------------------------------

## 8. Distribuzione statistica dell'intensità

L'intensità NON deve essere estratta da una distribuzione uniforme.

Per ciascuno scenario utilizzare una:

**distribuzione Gaussiana troncata specifica per scenario**

definita almeno da:

-   `mean_intensity`
-   `std_dev_intensity`

L'intervallo strutturale dell'intensità è:

`0 <= intensity <= 1`

La distribuzione deve quindi essere troncata ai limiti fisici 0 e 1.

Questo permette di avere:

-   valori centrali più probabili;
-   valori estremi meno frequenti;
-   caratteristiche differenti tra i quattro macro scenari.

------------------------------------------------------------------------

## 9. Memoria e mean reversion dell'intensità

Se lo scenario NON cambia, l'intensità del mese successivo non deve
essere un'estrazione indipendente.

Deve esistere memoria rispetto all'intensità del mese precedente.

È approvato un modello con:

-   dipendenza da `previousIntensity`;
-   richiamo verso `mean_intensity` dello scenario corrente;
-   componente casuale derivata dalla Gaussiana dello scenario;
-   limite alla variazione mensile.

Creare property globale:

`scenario_intensity_max_monthly_variation = 0.40`

Il nuovo valore deve quindi essere generato tramite una distribuzione
condizionata che:

1.  parte dall'intensità precedente;
2.  tende progressivamente verso la media strutturale dello scenario;
3.  conserva una componente casuale;
4.  impedisce variazioni mensili superiori al range massimo configurato.

La formula matematica definitiva è un processo **AR(1) mean-reverting**.

Costante tecnica fissa:

`INTENSITY_AR_RHO = 0.85`

Per lo scenario corrente `s`:

`conditionalMean = mean_intensity_s + rho * (previousIntensity - mean_intensity_s)`

`conditionalStdDev = std_dev_intensity_s * sqrt(1 - rho^2)`

La nuova intensità deve essere estratta direttamente da una **Gaussiana troncata condizionata** con questi parametri e con limiti:

`lower = max(0, previousIntensity - scenario_intensity_max_monthly_variation)`

`upper = min(1, previousIntensity + scenario_intensity_max_monthly_variation)`

`nextIntensity ~ TruncatedNormal(conditionalMean, conditionalStdDev, lower, upper)`

Non applicare un clamp ex-post al valore estratto. Il limite di variazione mensile è parte del dominio della distribuzione condizionata.

Con `rho = 0.85` l'intensità conserva una forte memoria mensile ma converge progressivamente verso la media strutturale dello scenario.

------------------------------------------------------------------------

## 10. Intensità nei primi mesi di un nuovo scenario

Restano configurate le property:

`new_scenario_first_month_max_intensity = 0.40`

`new_scenario_second_month_max_intensity = 0.70`

Questi valori NON devono essere interpretati come hard cap da applicare
meccanicamente tramite clamp.

L'obiettivo è invece modificare la distribuzione Gaussiana del nuovo
scenario nei primi mesi affinché:

-   nel primo mese la distribuzione sia orientata verso intensità
    contenute, con la grande maggioranza delle estrazioni entro circa
    0.40;
-   nel secondo mese la distribuzione possa ampliarsi, con la grande
    maggioranza delle estrazioni entro circa 0.70;
-   dal terzo mese venga utilizzata normalmente la dinamica
    dell'intensità prevista per lo scenario.

Se la distribuzione è opportunamente calibrata in modo che valori
superiori a 0.40 nel primo mese o 0.70 nel secondo appartengano soltanto
alle code statisticamente poco probabili, tali valori POSSONO essere
accettati.

Quindi 0.40 e 0.70 devono essere trattati come **soglie statistiche
morbide**, non come limiti assoluti.

Il `Reject & Redraw` deve essere utilizzato soltanto se
l'implementazione scelta non riesce a costruire una distribuzione
coerentemente concentrata entro le soglie previste.

La regola quantitativa definitiva utilizza il **95° percentile** come soglia morbida.

Costante tecnica fissa:

`ENTRY_SOFT_QUANTILE = 0.95`

### Primo mese dopo un cambio di scenario

Partire dalla Gaussiana troncata base dello scenario:

`TruncatedNormal(mean_intensity_s, std_dev_intensity_s, 0, 1)`

Se il suo 95° percentile è già `<= 0.40`, usare la distribuzione senza modifiche.

Altrimenti mantenere `std_dev_intensity_s` invariata e ridurre deterministicamente la media fino a ottenere:

`Q_0.95 = 0.40`

La media adattata viene trovata tramite bisezione sulla CDF della normale troncata.

### Secondo mese dello stesso nuovo scenario

Costruire prima la distribuzione AR(1) condizionata sul primo mese secondo la sezione 9, compresi i limiti di variazione mensile.

Se il suo 95° percentile è già `<= 0.70`, usarla senza modifiche.

Altrimenti mantenere invariata la deviazione standard condizionata e ridurre la media condizionata fino a ottenere:

`Q_0.95 = 0.70`

sempre tramite bisezione sulla CDF della normale troncata e rispettando gli stessi limiti inferiori/superiori.

Costanti tecniche fisse del solver:

`INTENSITY_MEAN_SOLVER_TOLERANCE = 1e-10`

`INTENSITY_MEAN_SOLVER_MAX_ITERATIONS = 100`

Se il solver non converge entro il numero massimo di iterazioni, la simulazione deve fallire con errore strutturale.

Dal terzo mese dello scenario viene utilizzata la normale dinamica AR(1) mean-reverting senza adattamento entry.

L'intensità iniziale del primo mese assoluto della simulazione NON è considerata ingresso in un nuovo regime e viene estratta dalla Gaussiana troncata base dello scenario iniziale.

------------------------------------------------------------------------

## 11. Intensità e generazione dei rendimenti

È approvato che l'intensità dello scenario influenzi sia:

-   il rendimento atteso;
-   la volatilità.

Principio generale:

### Intensità bassa

Il comportamento dell'ETF deve risultare più vicino a una condizione
macroeconomica neutrale:

-   effetto dello scenario sul rendimento meno pronunciato;
-   volatilità generalmente più contenuta.

### Intensità alta

Le caratteristiche dello scenario devono manifestarsi con maggiore
forza:

-   rendimento atteso dello scenario espresso più pienamente;
-   volatilità più elevata/coerente con una fase macro più intensa.

L'intensità è UNICA e condivisa da tutti gli ETF nello stesso mese.

Questo è fondamentale per mantenere coerenza macroeconomica trasversale
tra gli strumenti.

La formula matematica esatta con cui l'intensità modifica
`expected_return` e `volatility` sarà definita nel capitolo dedicato
alla generazione dei rendimenti.

------------------------------------------------------------------------

## 12. Ordine mensile tassativo

Per ogni mese successivo al primo:

1.  Leggere `currentScenario`.
2.  Leggere `currentIntensity`.
3.  Controllare il filtro di intensità sulla possibilità di transizione.
4.  Se `currentIntensity > scenario_transition_intensity_threshold`,
    mantenere automaticamente lo scenario.
5.  Altrimenti determinare se il regime si trova in ENTRY, PERSISTENCE o
    EXIT.
6.  Calcolare la probabilità autonoma di permanenza.
7.  Estrarre la permanenza.
8.  Se permane, mantenere lo scenario.
9.  Se non permane, consultare `transition_matrix`.
10. Estrarre lo scenario successivo dalla riga relativa a
    `currentScenario`.
11. Se cambia scenario, impostare `monthsInCurrentScenario = 1`.
12. Se non cambia, incrementare `monthsInCurrentScenario`.
13. Generare la nuova intensità:
    -   distribuzione iniziale condizionata se lo scenario è appena
        cambiato;
    -   modello con memoria e mean reversion se lo scenario permane.
14. Utilizzare scenario e intensità del mese per la successiva
    generazione dei rendimenti.

------------------------------------------------------------------------

## 13. Pseudocodice

``` text
scenario = extractInitialScenario(structural_probability)
monthsInCurrentScenario = 1

intensity = extractInitialIntensity(
    scenarioIntensityConfig[scenario]
)

FOR each next month:

    IF intensity > transitionIntensityThreshold:
        nextScenario = scenario

    ELSE:
        config = inertiaConfig[scenario]

        IF monthsInCurrentScenario <= config.entryMonths:
            stayProbability = config.entryProbability

        ELSE IF monthsInCurrentScenario < config.exitStartMonth:
            stayProbability = config.persistenceProbability

        ELSE:
            exitSteps =
                monthsInCurrentScenario
                - config.exitStartMonth
                + 1

            stayProbability = max(
                0,
                config.persistenceProbability
                - config.exitDecay * exitSteps
            )

        IF random(0,1) < stayProbability:
            nextScenario = scenario
        ELSE:
            nextScenario =
                drawFromTransitionMatrix(scenario)

    IF nextScenario != scenario:

        scenario = nextScenario
        monthsInCurrentScenario = 1

        intensity =
            extractEntryIntensityFromScenarioGaussian(
                scenario,
                monthInScenario = 1
            )

    ELSE:

        monthsInCurrentScenario += 1

        intensity =
            evolveIntensityWithMemoryAndMeanReversion(
                previousIntensity,
                scenarioMean,
                scenarioStdDev,
                maxMonthlyVariation
            )

        IF monthsInCurrentScenario == 2:
            adaptGaussianToSecondMonthSoftThreshold()
```

------------------------------------------------------------------------

## 14. Validazioni obbligatorie

Prima della simulazione devono essere validate tutte le configurazioni.

### 14.1 `transition_matrix`

Verificare:

-   esistenza di tutte le 16 righe;
-   assenza di duplicati;
-   probabilità comprese tra 0 e 1;
-   per ogni `from_scenario`, somma delle quattro probabilità uguale a 1
    entro la tolleranza tecnica prevista.

### 14.2 Tabella inerzia

Per ogni scenario devono esistere tutti i cinque parametri.

Validare:

-   `0 <= entry_probability <= 1`
-   `0 <= persistence_probability <= 1`
-   `entry_months >= 1`
-   `exit_start_month > entry_months`
-   `0 <= exit_decay <= 1`

### 14.3 `scenario_intensity_config`

Per ognuno dei quattro scenari deve esistere esattamente una
configurazione.

Validare almeno:

-   `0 <= mean_intensity <= 1`
-   `std_dev_intensity > 0`

### 14.4 Property globali

Devono esistere:

-   `scenario_transition_intensity_threshold`
-   `new_scenario_first_month_max_intensity`
-   `new_scenario_second_month_max_intensity`
-   `scenario_intensity_max_monthly_variation`

I valori percentuali devono essere compresi tra 0 e 1.

------------------------------------------------------------------------

## 15. Fail fast

Se manca una configurazione obbligatoria o una configurazione è
invalida:

**LA SIMULAZIONE NON PARTE.**

È vietato:

-   utilizzare fallback hardcoded;
-   normalizzare silenziosamente configurazioni errate;
-   inventare valori;
-   ignorare configurazioni mancanti.

L'errore deve indicare esplicitamente:

-   tabella/property;
-   scenario, quando applicabile;
-   parametro coinvolto;
-   valore errato o mancante.

------------------------------------------------------------------------

## 16. Stato minimo per percorso Monte Carlo

Ogni percorso Monte Carlo deve mantenere almeno:

-   `currentScenario`
-   `monthsInCurrentScenario`
-   `currentIntensity`

Per la dinamica dell'intensità deve inoltre essere disponibile:

-   `previousIntensity`

Lo stato viene aggiornato mensilmente.

Non è previsto alcun seed configurabile.

La ripetibilità delle simulazioni non è un requisito del sistema.

------------------------------------------------------------------------

## 17. Configurazione iniziale approvata

### Inerzia - tutti gli scenari

-   `entry_probability = 0.90`
-   `persistence_probability = 0.40`
-   `entry_months = 3`
-   `exit_start_month = 6`
-   `exit_decay = 0.15`

### Property globali

-   `scenario_transition_intensity_threshold = 0.60`
-   `new_scenario_first_month_max_intensity = 0.40`
-   `new_scenario_second_month_max_intensity = 0.70`
-   `scenario_intensity_max_monthly_variation = 0.40`

### Intensità per scenario

Per ogni scenario devono essere configurati:

-   `mean_intensity`
-   `std_dev_intensity`

I valori quantitativi iniziali saranno definiti separatamente.

------------------------------------------------------------------------

## 18. Decisioni definitive

-   Catena di Markov mensile.
-   Primo scenario estratto da `structural_probability`.
-   `transition_matrix` da 16 righe come probabilità strutturale di
    base.
-   Inerzia separata dalla matrice.
-   ENTRY: permanenza autonoma 0.90 per 3 mesi.
-   PERSISTENCE: permanenza autonoma costante 0.40.
-   EXIT: decadimento della persistence dal mese 6 di 0.15 per step
    mensile.
-   Nessuna `exit_probability`.
-   Persistence a zero: decide integralmente la matrice.
-   Intensità \> 0.60: nessuna transizione di scenario.
-   Intensità configurata tramite tabella separata
    `scenario_intensity_config`.
-   Una Gaussiana troncata specifica per ciascun macro scenario.
-   Parametri minimi della Gaussiana: `mean_intensity` e
    `std_dev_intensity`.
-   Intensità con memoria quando lo scenario permane.
-   Mean reversion verso la media strutturale dello scenario.
-   Variazione massima mensile configurabile, inizialmente 0.40.
-   Primo mese del nuovo scenario orientato statisticamente verso
    intensità \<= 0.40.
-   Secondo mese orientato statisticamente verso intensità \<= 0.70.
-   0.40 e 0.70 sono soglie statistiche morbide, non clamp rigidi.
-   Valori nelle code oltre tali soglie possono essere accettati se
    statisticamente poco frequenti.
-   Reject & Redraw sui primi due mesi solo se necessario perché la
    distribuzione implementata non risulta adeguatamente concentrata.
-   L'intensità influenza sia `expected_return` sia `volatility`.
-   L'intensità mensile è unica e condivisa da tutti gli ETF.
-   Tutte le transizioni sono ammesse se configurate.
-   Configurazione incompleta o invalida: simulazione bloccata.
-   Nessun valore strutturale hardcoded.
-   Nessun seed configurabile e nessun requisito di ripetibilità.

------------------------------------------------------------------------

## 19. Aspetti rinviati ai capitoli successivi

Non sono oggetto di questo capitolo e devono essere formalizzati
separatamente:

1.  valori definitivi di `mean_intensity` e `std_dev_intensity` per
    ciascuno scenario;
2.  valori quantitativi di `mean_intensity` e `std_dev_intensity` restano dati DB e non sono hardcoded;
3.  formula con cui l'intensità modifica il rendimento atteso: definita nel capitolo 11;
4.  formula con cui l'intensità modifica la volatilità: definita nel capitolo 11;
5.  generazione congiunta dei rendimenti correlati degli ETF: definita nei capitoli 15-16.

## Addendum v1.1 - regola autoritativa dell'intensità

Per evitare interpretazioni divergenti, in caso di contrasto con pseudocodice o formulazioni precedenti di questo capitolo valgono le seguenti regole:

1. scenario invariato -> AR(1) mean-reverting con `rho = 0.85`;
2. variazione massima mensile incorporata nei limiti della Gaussiana troncata, non tramite clamp;
3. primo mese dopo cambio scenario -> soft threshold P95 = 0.40;
4. secondo mese -> soft threshold P95 = 0.70 sulla distribuzione AR(1) condizionata;
5. terzo mese e successivi -> AR(1) standard;
6. primo mese assoluto della simulazione -> distribuzione base dello scenario iniziale, senza regola entry;
7. nessun reject/redraw supplementare per ottenere 0.40/0.70: la distribuzione deve essere adattata deterministicamente.
