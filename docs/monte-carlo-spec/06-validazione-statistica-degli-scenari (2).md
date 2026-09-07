# 06-validazione-statistica-degli-scenari

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

---

# 1. Scopo

Questo capitolo definisce il sistema di validazione statistica del generatore dei macro-scenari e dell'intensità.

La validazione deve essere eseguita PRIMA di utilizzare i risultati del motore per valutare i rendimenti degli ETF o dei portafogli.

In questa fase non devono essere generati rendimenti ETF, rendimenti di portafoglio, CAGR, drawdown, correlazioni tra ETF o capitale finale.

Il test deve simulare esclusivamente scenario iniziale, transizioni mensili, ENTRY, PERSISTENCE, EXIT, filtro dell'intensità, intensità mensile e durata dei regimi.

Obiettivo principale: osservare e misurare il comportamento effettivo del motore macro prima di introdurre la componente finanziaria.

In questa prima versione i risultati sono diagnostici. Non devono essere applicate soglie automatiche di pass/fail, salvo errori strutturali o configurazioni mancanti già definite nei capitoli precedenti.

---

# 2. Dimensione standard del test

Il test statistico standard deve utilizzare:

- 10000 percorsi indipendenti;
- 50 anni per percorso;
- 12 mesi per anno.

Numero totale di mesi simulati:

`10000 * 50 * 12 = 6.000.000`

Questi valori costituiscono la configurazione standard del test di validazione macro.

Non devono dipendere dai parametri della normale simulazione Monte Carlo utilizzata dall'utente.

Il test deve essere eseguibile dalla pagina dedicata alle statistiche.

I 6 milioni di mesi non devono essere necessariamente salvati individualmente in memoria o su database. Il servizio deve utilizzare aggregatori, contatori e strutture statistiche efficienti.

---

# 3. Nuova pagina frontend Statistics

Creare una nuova pagina dedicata denominata:

`Statistics`

La pagina deve servire esclusivamente all'analisi tecnica/statistica del motore Monte Carlo.

La pagina deve permettere di:

1. avviare il test statistico standard;
2. visualizzare lo stato di avanzamento;
3. ricevere dal backend tutti gli aggregati calcolati;
4. mostrare in modo leggibile tutti i risultati descritti in questo documento;
5. mantenere visibili i parametri di configurazione utilizzati nel test;
6. consentire il confronto dei risultati dopo successive modifiche manuali alle configurazioni DB.

Non deve nascondere risultati considerati poco importanti.

---

# 4. Configurazione mostrata nella pagina

Prima dei risultati mostrare chiaramente almeno:

## Test

- numero percorsi;
- anni per percorso;
- mesi totali simulati;
- data/ora esecuzione;
- durata elaborazione.

## Structural probability

Mostrare le quattro probabilità lette da:

`structural_probability`

## Transition matrix

Mostrare integralmente la matrice 4x4 letta da:

`transition_matrix`

## Inertia configuration

Mostrare per ciascun scenario:

- `entry_probability`;
- `persistence_probability`;
- `entry_months`;
- `exit_start_month`;
- `exit_decay`.

## Intensity configuration

Mostrare per ciascun scenario:

- `mean_intensity`;
- `std_dev_intensity`.

## Global properties

Mostrare:

- `scenario_transition_intensity_threshold`;
- `new_scenario_first_month_max_intensity`;
- `new_scenario_second_month_max_intensity`;
- `scenario_intensity_max_monthly_variation`.

La pagina deve rendere sempre evidente quali configurazioni hanno prodotto i risultati visualizzati.

---

# 5. Frequenza empirica dei macro-scenari

Calcolare, sull'intero campione dei 6 milioni di mesi:

- numero totale mesi in expansion;
- numero totale mesi in soft_landing;
- numero totale mesi in recession;
- numero totale mesi in stagflation;
- percentuale sul totale per ciascuno scenario.

Mostrare una tabella con Scenario, Mesi e Frequenza empirica.

In questa prima versione non esiste una frequenza target di lungo periodo obbligatoria.

Le frequenze sono diagnostiche.

La `structural_probability` non deve essere utilizzata come target della frequenza di lungo periodo, perché determina esclusivamente il primo mese di ciascun percorso.

---

# 6. Distribuzione della durata dei regimi

Un episodio o regime è una sequenza consecutiva di mesi appartenenti allo stesso macro-scenario.

Per ciascuno dei quattro scenari calcolare:

- numero episodi;
- durata media;
- durata mediana;
- P10;
- P25;
- P75;
- P90;
- P95;
- durata minima;
- durata massima.

Aggiungere inoltre un grafico o istogramma della distribuzione delle durate per ciascuno scenario.

---

# 7. Matrice empirica delle transizioni effettive

Costruire una matrice 4x4 calcolata osservando tutti i passaggi mensili effettivi:

`scenario(t) -> scenario(t+1)`

Questa matrice include implicitamente gli effetti di:

- intensity lock;
- ENTRY;
- PERSISTENCE;
- EXIT;
- transition matrix;
- self-transition della Markov.

Deve rappresentare il comportamento effettivo complessivo del motore.

Ogni riga deve essere normalizzata sul numero di mesi in cui quello scenario era lo stato corrente.

---

# 8. Matrice empirica condizionata all'accesso alla Markov

Costruire una seconda matrice 4x4 utilizzando soltanto i mesi nei quali:

1. il filtro dell'intensità non ha bloccato la transizione;
2. il filtro di inerzia non ha mantenuto automaticamente lo scenario;
3. il motore ha effettivamente consultato `transition_matrix`.

Questa matrice deve misurare:

`P(to_scenario | Markov effettivamente interrogata, from_scenario)`

Questa seconda matrice deve poter essere confrontata direttamente con la matrice configurata nel DB.

Mostrare affiancati:

- matrice DB;
- matrice empirica condizionata;
- differenza cella per cella;
- differenza assoluta cella per cella.

In questa prima versione non applicare soglie automatiche di fallimento.

---

# 9. Conteggio degli accessi alla Markov

Per ogni scenario mostrare:

- numero mesi totali nello scenario;
- numero mesi in cui la Markov è stata interrogata;
- percentuale di accesso alla Markov;
- numero mesi in cui la Markov non è stata interrogata.

---

# 10. Validazione ENTRY / PERSISTENCE / EXIT

Per ogni scenario registrare quanti mesi sono trascorsi in:

- ENTRY;
- PERSISTENCE;
- EXIT.

Mostrare:

- numero mesi per fase;
- percentuale sul totale dello scenario;
- probabilità empirica di permanenza nella fase;
- numero di permanenze automatiche;
- numero di accessi alla Markov.

Per ENTRY confrontare `entry_probability` configurata con la frequenza empirica della protezione ENTRY.

Per PERSISTENCE confrontare `persistence_probability` configurata con la frequenza empirica della protezione PERSISTENCE.

Per EXIT mostrare la persistenza effettiva per mese di permanenza.

---

# 11. Curva empirica dell'EXIT decay

Per ogni scenario costruire una tabella/grafico che mostri:

- mese nello scenario;
- `effectivePersistence` teorica;
- numero osservazioni;
- frequenza empirica di protezione;
- frequenza di accesso alla Markov.

La curva deve essere disponibile separatamente per ciascun macro-scenario.

---

# 12. Motivo della permanenza o della transizione

Ogni decisione mensile deve essere classificata in una delle seguenti cause:

- `INTENSITY_LOCK`
- `ENTRY_PROTECTION`
- `PERSISTENCE_PROTECTION`
- `EXIT_PROTECTION`
- `MARKOV_SELF_TRANSITION`
- `MARKOV_TRANSITION`

Mostrare conteggi e percentuali:

- globali;
- per scenario;
- per fase, quando applicabile.

Questa statistica deve rendere evidente quale meccanismo domina realmente la dinamica macro.

---

# 13. Numero effettivo di cambi di scenario

Calcolare:

- numero totale di cambi scenario;
- cambi medi per percorso;
- cambi medi per anno;
- mediana cambi per percorso;
- P10;
- P25;
- P75;
- P90;
- P95;
- minimo;
- massimo.

Mostrare inoltre la stessa statistica suddivisa per scenario di origine.

---

# 14. Frequenza delle singole transizioni

Per ciascuna transizione reale mostrare:

- conteggio;
- percentuale rispetto a tutte le transizioni;
- percentuale rispetto alle partenze dallo scenario FROM.

Mostrare anche le quattro self-transition Markov separatamente.

---

# 15. Distribuzione dell'intensità per scenario

Per ciascuno scenario calcolare:

- numero osservazioni;
- media;
- mediana;
- deviazione standard;
- P5;
- P10;
- P25;
- P75;
- P90;
- P95;
- minimo;
- massimo.

Mostrare la distribuzione mediante istogramma o density chart.

Mostrare inoltre:

- `mean_intensity` configurata;
- `std_dev_intensity` configurata;
- media empirica;
- deviazione standard empirica.

Il confronto è diagnostico.

---

# 16. Intensità del primo mese di regime

Separare tutte le osservazioni con:

`monthsInCurrentScenario = 1`

Per ogni scenario calcolare:

- media;
- mediana;
- deviazione standard;
- P5;
- P25;
- P75;
- P95;
- minimo;
- massimo;
- percentuale `intensity <= 0.40`;
- percentuale `intensity > 0.40`.

Target diagnostico iniziale:

`P(intensity > 0.40 | first month) <= circa 5%`

Il 5% non è un hard cap e non deve automaticamente bloccare il test.

---

# 17. Intensità del secondo mese di regime

Separare tutte le osservazioni con:

`monthsInCurrentScenario = 2`

Per ogni scenario calcolare:

- media;
- mediana;
- deviazione standard;
- P5;
- P25;
- P75;
- P95;
- minimo;
- massimo;
- percentuale `intensity <= 0.70`;
- percentuale `intensity > 0.70`.

Target diagnostico iniziale:

`P(intensity > 0.70 | second month) <= circa 5%`

Anche questo è un target diagnostico e non un hard cap.

---

# 18. Distribuzione dell'intensità dal terzo mese

Per:

`monthsInCurrentScenario >= 3`

mostrare separatamente le statistiche dell'intensità.

Questo consente di distinguere fase di ingresso e regime maturo.

---

# 19. Memoria dell'intensità

Quando lo scenario permane tra `t` e `t+1`, calcolare:

`deltaIntensity = intensity(t+1) - intensity(t)`

e:

`absoluteDeltaIntensity = abs(deltaIntensity)`

Mostrare per scenario:

- media delta;
- mediana delta;
- deviazione standard delta;
- P5;
- P25;
- P75;
- P95;
- media variazione assoluta;
- mediana variazione assoluta;
- massimo incremento;
- massima diminuzione.

---

# 20. Significato della max monthly variation

Decisione definitiva:

`scenario_intensity_max_monthly_variation = 0.40`

significa variazione assoluta massima sulla scala 0-1.

Quindi:

`abs(intensity(t+1) - intensity(t)) <= 0.40`

Non significa ±40% del valore precedente.

---

# 21. Validazione del limite di variazione

Mostrare:

- numero variazioni valutate;
- numero variazioni superiori al limite;
- percentuale violazioni;
- massimo valore assoluto osservato.

Se l'algoritmo implementa correttamente il limite, le violazioni devono essere zero salvo tolleranza floating point.

---

# 22. Autocorrelazione dell'intensità

Per ciascuno scenario calcolare almeno la correlazione lag-1:

`Corr(Intensity_t, Intensity_t-1)`

utilizzando solamente coppie di mesi consecutivi appartenenti allo stesso scenario.

Non definire ancora un valore target obbligatorio.

---

# 23. Intensità e probabilità di permanenza

Dividere l'intensità in fasce:

- `[0.00, 0.20)`
- `[0.20, 0.40)`
- `[0.40, 0.60]`
- `(0.60, 0.80]`
- `(0.80, 1.00]`

Per ogni fascia mostrare:

- numero osservazioni;
- percentuale permanenza scenario;
- percentuale cambi scenario;
- percentuale intensity lock;
- percentuale accesso Markov.

Questo deve rendere visibile l'effetto della property:

`scenario_transition_intensity_threshold = 0.60`

---

# 24. Distribuzione per anno di simulazione

Per verificare eventuali effetti transitori dovuti a `structural_probability`, calcolare la frequenza degli scenari per:

- anno 1;
- anni 2-5;
- anni 6-10;
- anni 11-20;
- anni 21-50.

Mostrare tabella e grafico.

---

# 25. Distribuzione del primo scenario

Su 10.000 percorsi confrontare:

- probabilità configurate in `structural_probability`;
- frequenze empiriche del primo scenario;
- differenza.

Questa verifica deve convergere statisticamente alla configurazione DB.

---

# 26. Stabilità tra percorsi

Per ciascun percorso calcolare almeno:

- % mesi expansion;
- % mesi soft_landing;
- % mesi recession;
- % mesi stagflation;
- numero cambi scenario.

Poi mostrare la distribuzione tra i 10.000 percorsi:

- media;
- mediana;
- P5;
- P25;
- P75;
- P95;
- min;
- max.

---

# 27. Regimi estremamente lunghi

Per ciascuno scenario mostrare:

- numero episodi > 12 mesi;
- > 24 mesi;
- > 36 mesi;
- > 60 mesi;
- percentuale sul totale episodi dello scenario.

Non definire ancora soglie automatiche di errore.

---

# 28. Regimi estremamente brevi

Per ciascuno scenario mostrare:

- episodi di 1 mese;
- episodi di 2 mesi;
- episodi di 3 mesi;
- percentuale sul totale.

---

# 29. Sequenze e ritorni repentini

Calcolare almeno:

- `A -> B -> A` entro 2 mesi;
- `A -> B -> A` entro 3 mesi;
- numero di cambi consecutivi in mesi adiacenti;
- percentuale di episodi seguiti da ritorno immediato allo scenario precedente.

---

# 30. Output API del servizio statistico

Il backend deve restituire un DTO/JSON strutturato contenente almeno:

- metadata del test;
- configurazione utilizzata;
- scenario frequencies;
- regime duration statistics;
- effective transition matrix;
- conditional Markov matrix;
- transition matrix differences;
- Markov access statistics;
- phase statistics;
- exit decay statistics;
- decision reason statistics;
- transition counts;
- intensity statistics;
- first month intensity statistics;
- second month intensity statistics;
- mature regime intensity statistics;
- intensity deltas;
- intensity autocorrelation;
- intensity bands;
- time-window scenario distributions;
- initial scenario validation;
- per-path distributions;
- short regime statistics;
- long regime statistics;
- rapid reversal statistics.

Il frontend non deve ricalcolare queste metriche.

---

# 31. Struttura consigliata della pagina Statistics

Organizzare la pagina in sezioni o tab interne:

- A. Configurazione test
- B. Frequenza scenari
- C. Durata regimi
- D. Transizioni
- E. Inerzia
- F. Cause di permanenza/transizione
- G. Intensità
- H. Intensità in ingresso
- I. Memoria intensità
- J. Percorsi
- K. Anomalie macro

---

# 32. Grafici consigliati

Mostrare almeno:

1. bar chart frequenza dei quattro scenari;
2. istogramma durate regime;
3. heatmap/matrice delle transizioni effettive;
4. heatmap/matrice Markov condizionata;
5. heatmap delle differenze DB vs empirica;
6. grafico curva EXIT decay;
7. stacked bar delle cause di permanenza/transizione;
8. distribuzione intensità per scenario;
9. distribuzione intensità primo mese;
10. distribuzione intensità secondo mese;
11. boxplot o equivalente dei delta intensità;
12. andamento della frequenza scenari per blocchi temporali;
13. distribuzione del numero di cambi per percorso.

Riutilizzare la libreria grafica già presente nel progetto quando possibile.

---

# 33. Nessuna perdita di informazione

La pagina Statistics è uno strumento tecnico di calibrazione.

Pertanto:

- non nascondere automaticamente outlier;
- non aggregare in modo tale da perdere risultati importanti;
- non mostrare solo un singolo score;
- non applicare giudizi automatici buono/cattivo nella prima versione;
- mostrare valori grezzi e aggregati utili alla diagnosi.

I risultati verranno analizzati manualmente dopo i primi test.

---

# 34. Pass/fail nella prima versione

Non introdurre soglie economiche automatiche di pass/fail per:

- frequenza scenari;
- durata scenari;
- distribuzione intensità;
- autocorrelazione;
- numero cambi;
- regimi lunghi/brevi.

Restano errori tecnici bloccanti:

- configurazioni mancanti;
- probabilità invalide;
- matrici incomplete;
- valori fuori dominio;
- violazione strutturale di limiti hard definiti dall'algoritmo;
- impossibilità di eseguire il test.

---

# 35. Obiettivo della prima esecuzione

La prima esecuzione deve permettere di capire:

- quanto tempo passa realmente il motore in ogni scenario;
- quanto dura mediamente ogni regime;
- quanto pesa davvero la Markov;
- quanto pesa l'inerzia;
- quanto pesa l'intensity lock;
- se ENTRY protegge troppo o troppo poco;
- se EXIT riduce davvero la persistenza;
- se la distribuzione dell'intensità è credibile;
- se primo e secondo mese rispettano le soglie statistiche desiderate;
- se l'intensità ha abbastanza memoria;
- se i regimi cambiano troppo spesso;
- se esistono percorsi intrappolati;
- se esistono ritorni `A -> B -> A` troppo frequenti.

Le configurazioni saranno eventualmente corrette sulla base di questi risultati.

---

# 36. Decisioni definitive del capitolo

- Test standard: 10.000 percorsi.
- Durata: 50 anni.
- Passo: 12 mesi/anno.
- Totale: 6 milioni di mesi.
- Test separato dai rendimenti ETF.
- Tutti i risultati mostrati in una nuova pagina Statistics.
- Frequenze scenari inizialmente diagnostiche.
- Nessun target strutturale di lungo periodo imposto.
- Durate: media, mediana, P10/P25/P75/P90/P95, min e max.
- Matrice empirica effettiva approvata.
- Matrice condizionata ai soli accessi Markov approvata.
- Analisi ENTRY/PERSISTENCE/EXIT approvata.
- Analisi delle cause di permanenza/transizione approvata.
- Analisi completa dell'intensità approvata.
- Primo mese: target diagnostico circa <=5% oltre 0.40.
- Secondo mese: target diagnostico circa <=5% oltre 0.70.
- `scenario_intensity_max_monthly_variation = 0.40` interpretato come variazione assoluta di 0.40.
- Analisi della memoria e autocorrelazione approvata.
- Analisi di regimi brevi/lunghi e ritorni repentini approvata.
- Backend responsabile dei calcoli statistici.
- Frontend responsabile della visualizzazione.
- Nessun giudizio economico automatico nella prima versione.
- I primi risultati verranno usati per calibrare successivamente le configurazioni del motore.
