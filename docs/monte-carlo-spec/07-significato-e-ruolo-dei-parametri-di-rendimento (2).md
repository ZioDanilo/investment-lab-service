# 07-significato-e-ruolo-dei-parametri-di-rendimento

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

---

# 1. Scopo

Questo capitolo definisce il significato e il ruolo dei parametri di rendimento utilizzati dal nuovo Monte Carlo Engine.

L'obiettivo è separare chiaramente:

- parametri che partecipano attivamente alla generazione dei rendimenti;
- parametri che fungono da vincoli statistici di plausibilità;
- parametri utilizzati esclusivamente come benchmark diagnostici;
- metriche che devono emergere dalla simulazione e non essere imposte a priori.

Questo capitolo non definisce ancora le formule definitive di mensilizzazione, la distribuzione dei rendimenti o il sistema di correlazione degli shock. Questi aspetti vengono affrontati nei capitoli successivi.

---

# 2. Expected return condizionato allo scenario

Per ciascun ETF e per ciascuno dei quattro macro-scenari è disponibile:

`expected_return`

Gli scenari sono:

- expansion;
- soft_landing;
- recession;
- stagflation.

`expected_return` rappresenta il rendimento semplice medio annuale atteso dell'ETF condizionato al verificarsi di quello specifico scenario macroeconomico.

Non rappresenta:

- il rendimento certo dell'ETF;
- il rendimento che l'ETF deve necessariamente ottenere in un singolo anno;
- il rendimento massimo;
- il rendimento di lungo periodo indipendente dagli scenari.

Rappresenta il centro della distribuzione dei rendimenti dell'ETF nello specifico regime.

Il valore è annualizzato nel database.

Prima della generazione mensile deve essere trasformato opportunamente in un valore mensile secondo le regole definite nel capitolo 08.

---

# 3. Volatility condizionata allo scenario

Per ciascun ETF e scenario è disponibile:

`volatility`

La volatility rappresenta la volatilità annualizzata attesa dei rendimenti dell'ETF all'interno dello specifico macro-scenario.

Non rappresenta:

- un limite massimo;
- un return range;
- un drawdown;
- una perdita massima.

La volatility determina l'ampiezza della dispersione dei rendimenti intorno all'expected return.

Nel nuovo motore:

`volatility scenario -> intensity del mese -> volatility effettiva del mese`

La formula con cui l'intensità modifica la volatilità sarà definita nel capitolo dedicato al ruolo dell'intensità.

Prima dell'utilizzo mensile, la volatilità annualizzata deve essere trasformata in volatilità mensile secondo le regole del capitolo 08.

---

# 4. Return range

Per ciascun ETF e scenario sono disponibili:

- `return_range.min`;
- `return_range.max`.

Il return range rappresenta un intervallo annuale di rendimento considerato plausibile per l'ETF all'interno dello specifico scenario.

Il return range NON deve essere utilizzato come distribuzione da cui estrarre direttamente il rendimento.

La generazione del rendimento deriva invece da:

- expected return;
- volatility;
- intensity;
- shock casuale;
- successivamente, correlazione degli shock tra ETF.

Il return range svolge una funzione di controllo della plausibilità statistica.

La trasformazione del return range annuale in un equivalente utilizzabile nel modello mensile NON deve essere effettuata mediante semplice divisione per 12.

La regola matematica sarà definita nel capitolo 08.

---

# 5. Max Drawdown

Il campo:

`max_drawdown`

NON deve partecipare alla generazione dei rendimenti nel nuovo Monte Carlo Engine.

Il Max Drawdown deve emergere endogenamente dalla traiettoria simulata.

Sequenza concettuale:

`rendimenti mensili -> valore ETF/capitale -> running peak -> drawdown -> Max Drawdown`

Il motore non deve:

- forzare il raggiungimento del max_drawdown presente nel DB;
- impedire automaticamente il superamento del max_drawdown presente nel DB;
- modificare i rendimenti per avvicinare il drawdown a un valore prefissato.

Il campo `max_drawdown` è quindi deprecato come input del Monte Carlo Engine 2.0.

Non eliminarlo fisicamente dal database in questa fase senza prima verificare tutte le dipendenze del progetto.

La sua eventuale eliminazione dal modello dati sarà valutata separatamente.

---

# 6. Long-term expected return

Il campo:

`long_term_expected_return`

rappresenta il CAGR nominale annuo forward-looking di lungo periodo stimato per l'ETF.

Nel nuovo Monte Carlo Engine questo valore è esclusivamente un benchmark diagnostico.

NON deve:

- modificare direttamente i rendimenti mensili;
- correggere una simulazione in corso;
- forzare il CAGR finale;
- provocare mean reversion del rendimento verso il benchmark;
- modificare automaticamente gli expected return dei quattro scenari.

Il rendimento di lungo periodo deve emergere dal modello.

A posteriori deve essere possibile confrontare:

`rendimento emergente dalla simulazione`

con:

`long_term_expected_return`

Una divergenza rilevante deve essere analizzata attraverso le statistiche e le configurazioni del modello.

Il sistema non deve correggere automaticamente il risultato per farlo convergere al benchmark.

---

# 7. Parametri general

Gli eventuali parametri generali dell'ETF, indipendenti dal macro-scenario, devono essere trattati come benchmark diagnostici strutturali.

In particolare, quando disponibili:

- long-term expected return;
- volatility generale;
- return range generale.

Questi valori descrivono il comportamento strutturale atteso dell'ETF.

Le statistiche macro descrivono invece il comportamento condizionato allo scenario.

La simulazione deve produrre risultati emergenti che possano essere confrontati con entrambi.

Schema concettuale:

`GENERAL -> benchmark di lungo periodo`

`MACRO STATISTICS -> comportamento condizionato`

`SIMULAZIONE -> comportamento emergente`

Il confronto deve essere mostrato nelle statistiche diagnostiche quando verrà implementata la validazione dei rendimenti.

---

# 8. Shock casuale

Lo shock casuale è necessario per trasformare la volatilità in una variazione effettiva del rendimento.

Non rappresenta un nuovo parametro economico e non deve essere memorizzato come parametro strutturale dell'ETF.

Concettualmente, dopo aver determinato:

- expected return mensile;
- volatility mensile effettiva;

viene estratta una variabile casuale standardizzata.

Nella forma più semplice:

`Z ~ N(0,1)`

e il rendimento può essere espresso concettualmente come:

`R_month = mu_month + sigma_month * Z`

La distribuzione definitiva di `Z` e del rendimento non viene stabilita in questo capitolo.

Sarà definita nel capitolo dedicato alla distribuzione dei rendimenti.

Lo shock casuale è quindi il meccanismo con cui la volatilità si materializza nella traiettoria simulata.

Senza shock casuale, applicare sempre il solo rendimento medio mensile produrrebbe traiettorie artificialmente regolari e la volatility presente nel database non avrebbe effetto reale.

---

# 9. Shock casuali e correlazioni

Gli shock casuali dei diversi ETF non dovranno essere necessariamente indipendenti.

Nel capitolo dedicato alle correlazioni verrà definito il meccanismo con cui gli shock standardizzati dei diversi ETF vengono correlati secondo la matrice prevista per il macro-scenario corrente.

Schema concettuale:

`scenario`

-> `expected return ETF`

-> `volatility ETF`

-> `intensity`

-> `shock casuale standardizzato`

-> `correlazione degli shock`

-> `rendimento mensile ETF`

La correlazione non modifica direttamente l'expected return dell'ETF.

Interviene sulla dipendenza tra gli shock dei diversi ETF.

---

# 10. Principio di non correzione del risultato

Principio fondamentale del Monte Carlo Engine 2.0:

**Il motore non deve correggere una simulazione perché il risultato si sta allontanando da un benchmark.**

I benchmark servono a diagnosticare il modello, non a pilotarne il risultato.

Se, per esempio:

`long_term_expected_return = 0.08`

e le simulazioni di lunghissimo periodo producono sistematicamente un CAGR molto superiore o inferiore, il sistema deve:

1. mostrare la divergenza;
2. consentire di analizzarne le cause;
3. permettere di intervenire consapevolmente sulle configurazioni.

Non deve correggere automaticamente i rendimenti simulati.

---

# 11. Ruolo definitivo dei parametri

| Parametro | Ruolo |
|---|---|
| `expected_return` macro | Input attivo: centro della distribuzione condizionata allo scenario |
| `volatility` macro | Input attivo: dispersione dei rendimenti nello scenario |
| `return_range` macro | Vincolo/controllo statistico di plausibilità |
| `max_drawdown` | Non utilizzato come input del nuovo motore |
| `long_term_expected_return` | Benchmark diagnostico |
| parametri `general` | Benchmark diagnostici strutturali |
| shock casuale | Meccanismo necessario per materializzare la volatilità |
| correlazione | Dipendenza tra gli shock degli ETF; trattata nel capitolo dedicato |

---

# 12. Decisioni definitive del capitolo

- `expected_return` è annuale e condizionato allo scenario.
- `expected_return` rappresenta il centro della distribuzione.
- `volatility` è annualizzata e condizionata allo scenario.
- L'intensità del mese modificherà la volatilità effettiva.
- La formula intensity-volatility sarà definita successivamente.
- `return_range` rappresenta un intervallo di plausibilità.
- `return_range` non genera direttamente i rendimenti.
- `return_range` non deve essere semplicemente diviso per 12.
- `max_drawdown` non partecipa alla generazione.
- Il drawdown deve emergere dalla traiettoria simulata.
- `max_drawdown` è deprecato come input del nuovo Monte Carlo Engine.
- Non eliminare ancora fisicamente il campo dal DB senza verifica delle dipendenze.
- `long_term_expected_return` è un benchmark diagnostico puro.
- Il motore non deve convergere artificialmente verso il long-term expected return.
- I parametri general sono benchmark diagnostici.
- Lo shock casuale viene mantenuto.
- Lo shock casuale non è un parametro economico aggiuntivo.
- Lo shock casuale materializza la volatilità.
- Gli shock saranno successivamente correlati tra ETF.
- Il Monte Carlo deve produrre risultati emergenti e non risultati pilotati verso benchmark prefissati.
