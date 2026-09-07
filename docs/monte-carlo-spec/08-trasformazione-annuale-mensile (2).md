# 08-trasformazione-annuale-mensile

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

---

# 1. Scopo

Questo capitolo definisce come trasformare i parametri annuali presenti nel database nelle grandezze mensili utilizzate dal Monte Carlo Engine.

Il motore lavora con passo temporale mensile.

Le trasformazioni devono avvenire a runtime nel backend prima della generazione dei rendimenti.

Non devono essere introdotte nuove property o nuove variabili di configurazione nel database per i valori mensilizzati: tutte le grandezze descritte in questo documento sono derivate dai parametri già censiti.

---

# 2. Principio generale

Il database conserva i parametri finanziari nella loro forma annuale.

Il motore opera invece mese per mese.

Flusso generale:

`parametri annuali DB -> trasformazione mensile -> applicazione intensità -> shock casuale -> controllo return range`

La mensilizzazione deve essere deterministica e centralizzata nel servizio, evitando formule duplicate in punti diversi del codice.

---

# 3. Expected return annuale -> mensile

Per ogni ETF e macro-scenario il campo:

`expected_return`

rappresenta il rendimento semplice medio annuale atteso condizionato allo scenario.

La conversione mensile deve utilizzare la trasformazione composta:

`monthlyExpectedReturn = (1 + annualExpectedReturn)^(1/12) - 1`

NON utilizzare:

`annualExpectedReturn / 12`

Esempio:

`annualExpectedReturn = 0.12`

produce:

`monthlyExpectedReturn ≈ 0.009489`

La conversione composta garantisce:

`(1 + monthlyExpectedReturn)^12 - 1 = annualExpectedReturn`

---

# 4. Validazione dell'expected return

Per poter applicare la trasformazione composta deve valere:

`annualExpectedReturn > -1`

Se:

`annualExpectedReturn <= -1`

la configurazione è invalida e il servizio deve effettuare fail-fast.

Non utilizzare fallback, clamp o correzioni automatiche.

---

# 5. Volatility annuale -> mensile

La volatilità annualizzata viene trasformata secondo la square-root-of-time rule:

`monthlyVolatility = annualVolatility / sqrt(12)`

Esempio:

`annualVolatility = 0.20`

produce:

`monthlyVolatility ≈ 0.057735`

La volatility mensile così ottenuta rappresenta la dispersione base mensile relativa allo scenario corrente.

Successivamente verrà modificata dall'intensità effettiva dello scenario del mese.

---

# 6. Validazione della volatility

Deve valere:

`annualVolatility >= 0`

Valori negativi sono configurazioni invalide.

Il caso:

`annualVolatility = 0`

è ammesso esclusivamente per una distribuzione deterministica coerente.

In questo caso non è possibile calcolare gli z-score del return range tramite divisione per volatility.

Se volatility è zero, il return range deve coincidere con l'expected return:

`returnRangeMin = expectedReturn`

e:

`returnRangeMax = expectedReturn`

Se questa condizione non è rispettata, la configurazione deve essere considerata invalida e il servizio deve effettuare fail-fast.

---

# 7. Return range annuale

Per ciascun ETF e scenario sono disponibili:

- `return_range.min`
- `return_range.max`

Il return range rappresenta un intervallo annuale di plausibilità statistica.

Non rappresenta:

- la distribuzione dei rendimenti;
- un intervallo uniforme da cui estrarre;
- un valore da dividere per 12;
- un target da raggiungere.

Il return range viene utilizzato per derivare la posizione statistica degli estremi rispetto alla distribuzione annuale dello scenario.

---

# 8. Validazione del return range

Deve sempre valere:

`returnRangeMin <= annualExpectedReturn <= returnRangeMax`

Inoltre:

`returnRangeMin >= -1`

Se una delle condizioni non è rispettata, la configurazione è invalida e la simulazione non deve partire.

Non effettuare correzioni automatiche.

---

# 9. Calcolo degli z-score degli estremi annuali

Quando:

`annualVolatility > 0`

calcolare:

`zMin = (returnRangeMin - annualExpectedReturn) / annualVolatility`

`zMax = (returnRangeMax - annualExpectedReturn) / annualVolatility`

Questi valori rappresentano quanto gli estremi plausibili annuali distano dall'expected return in unità di volatilità.

Esempio:

`expectedReturn = 0.10`

`annualVolatility = 0.20`

`returnRangeMin = -0.30`

`returnRangeMax = 0.50`

produce:

`zMin = -2`

`zMax = +2`

Gli z-score non devono essere salvati nel database.

Devono essere calcolati a runtime.

---

# 10. Trasformazione del return range in ambito mensile

Il return range annuale NON deve essere:

- diviso per 12;
- convertito tramite semplice capitalizzazione composta degli estremi.

Il motore deve mantenere la distanza statistica espressa dagli z-score.

Prima dell'applicazione dell'intensità:

`monthlyRangeMin = monthlyExpectedReturn + zMin * monthlyVolatility`

`monthlyRangeMax = monthlyExpectedReturn + zMax * monthlyVolatility`

Questo conserva nel dominio mensile la posizione relativa degli estremi rispetto alla media e alla volatilità.

---

# 11. Ordine di applicazione dell'intensità

Decisione definitiva:

prima si mensilizzano i parametri annuali e successivamente si applica l'intensità dello scenario.

Ordine:

1. leggere `annualExpectedReturn`;
2. leggere `annualVolatility`;
3. leggere `returnRangeMin` e `returnRangeMax`;
4. calcolare `monthlyExpectedReturn`;
5. calcolare `monthlyVolatility`;
6. calcolare `zMin` e `zMax`;
7. determinare l'intensità del mese;
8. trasformare expected return e volatility nei rispettivi valori mensili effettivi;
9. ricostruire il return range mensile effettivo;
10. generare lo shock casuale;
11. ottenere il rendimento mensile;
12. verificarne la plausibilità rispetto al range effettivo.

---

# 12. Expected return mensile effettivo

Dopo la mensilizzazione, l'intensità dello scenario modifica il valore:

`monthlyExpectedReturn`

producendo:

`effectiveMonthlyExpectedReturn`

La formula matematica esatta con cui l'intensità modifica l'expected return NON viene definita in questo capitolo.

Sarà definita nel capitolo dedicato al ruolo dell'intensità.

Questo documento stabilisce esclusivamente che:

`annualExpectedReturn -> monthlyExpectedReturn -> intensity adjustment -> effectiveMonthlyExpectedReturn`

---

# 13. Volatility mensile effettiva

Analogamente:

`annualVolatility -> monthlyVolatility -> intensity adjustment -> effectiveMonthlyVolatility`

La formula esatta intensity-volatility sarà definita successivamente.

L'intensità deve quindi operare sulla grandezza già mensilizzata.

---

# 14. Return range mensile effettivo

Dopo aver ottenuto:

- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`;

il range mensile deve essere ricalcolato utilizzando gli z-score derivati dai parametri annuali:

`effectiveMonthlyRangeMin = effectiveMonthlyExpectedReturn + zMin * effectiveMonthlyVolatility`

`effectiveMonthlyRangeMax = effectiveMonthlyExpectedReturn + zMax * effectiveMonthlyVolatility`

In questo modo l'intensità modifica indirettamente anche il range plausibile del mese.

Un regime più intenso può quindi produrre:

- spostamento del centro della distribuzione;
- variazione della dispersione;
- conseguente modifica degli estremi mensili plausibili.

Non è necessaria una property aggiuntiva per questo comportamento.

---

# 15. Shock casuale

Dopo aver determinato:

- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`;

il motore genera lo shock casuale secondo la distribuzione che verrà definita nel capitolo successivo.

Forma concettuale:

`monthlyReturn = effectiveMonthlyExpectedReturn + effectiveMonthlyVolatility * shock`

La forma definitiva dipenderà dalla distribuzione scelta.

Gli shock dei diversi ETF verranno successivamente correlati nel capitolo dedicato alle correlazioni.

---

# 16. Controllo del return range: Reject & Redraw

Dopo l'estrazione del rendimento mensile deve essere verificato:

`effectiveMonthlyRangeMin <= monthlyReturn <= effectiveMonthlyRangeMax`

Se il rendimento estratto cade fuori dal range:

- NON effettuare clamp;
- NON sostituire il valore con il minimo;
- NON sostituire il valore con il massimo;
- NON modificare artificialmente il rendimento.

Il valore deve essere scartato e deve essere effettuata una nuova estrazione.

Meccanismo:

`Reject & Redraw`

Il processo continua fino a ottenere un rendimento appartenente al range mensile effettivo.

Il capitolo dedicato alla distribuzione potrà definire eventuali protezioni tecniche contro configurazioni patologiche che producano un numero anomalo di redraw.

---

# 17. Perché non utilizzare il clamp

Il clamp produrrebbe accumuli artificiali di osservazioni esattamente sugli estremi del range.

Esempio scorretto:

`return < min -> return = min`

`return > max -> return = max`

Questo altererebbe la distribuzione empirica.

Reject & Redraw mantiene invece una distribuzione troncata coerente con il vincolo di plausibilità.

---

# 18. Correlazioni

Le correlazioni NON vengono mensilizzate.

Una correlazione configurata per uno scenario mantiene lo stesso valore indipendentemente dal passo temporale della simulazione.

Esempio:

`correlation = 0.65`

rimane:

`0.65`

quando applicata agli shock mensili.

La costruzione e validazione delle matrici di correlazione sarà affrontata nel capitolo dedicato.

---

# 19. Max Drawdown

`max_drawdown` non viene mensilizzato.

Come stabilito nel capitolo 07, non viene utilizzato come input per la generazione dei rendimenti.

Il drawdown emerge dalla traiettoria simulata.

---

# 20. Long-term expected return

`long_term_expected_return` rimane annualizzato.

Non viene trasformato in un parametro mensile operativo perché è un benchmark diagnostico e non partecipa alla generazione dei rendimenti.

---

# 21. Parametri general

I parametri general utilizzati esclusivamente come benchmark diagnostici rimangono nella loro unità annualizzata.

Non devono essere introdotti nella generazione mensile per correggere o pilotare i risultati.

---

# 22. Variabili runtime derivate

Il motore può utilizzare internamente variabili quali:

- `monthlyExpectedReturn`;
- `monthlyVolatility`;
- `zMin`;
- `zMax`;
- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`;
- `monthlyRangeMin`;
- `monthlyRangeMax`;
- `effectiveMonthlyRangeMin`;
- `effectiveMonthlyRangeMax`.

Queste variabili:

- NON richiedono nuove colonne DB;
- NON richiedono nuove property;
- NON devono essere configurate dall'utente;
- devono essere calcolate dal backend;
- possono essere mantenute in strutture runtime appropriate.

Quando possibile, le grandezze che dipendono esclusivamente dai dati annuali possono essere pre-calcolate una volta all'inizio della simulazione per evitare calcoli ripetuti.

---

# 23. Pre-calcolo consigliato

Per ciascuna coppia:

`ETF + macroScenario`

è possibile calcolare una sola volta prima dei loop principali:

- `monthlyExpectedReturn`;
- `monthlyVolatility`;
- `zMin`;
- `zMax`.

Questi valori non cambiano durante la simulazione finché non cambia la configurazione DB.

I valori effettivi dipendenti dall'intensità devono invece essere calcolati per il mese corrente:

- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`;
- `effectiveMonthlyRangeMin`;
- `effectiveMonthlyRangeMax`.

---

# 24. Fail-fast

Prima dell'avvio della simulazione validare per ogni ETF e scenario almeno:

`annualExpectedReturn > -1`

`annualVolatility >= 0`

`returnRangeMin >= -1`

`returnRangeMin <= annualExpectedReturn`

`annualExpectedReturn <= returnRangeMax`

Se:

`annualVolatility == 0`

deve inoltre valere:

`returnRangeMin == annualExpectedReturn == returnRangeMax`

Qualunque violazione deve impedire l'avvio della simulazione.

L'errore deve identificare chiaramente:

- ETF;
- ISIN;
- scenario;
- parametro;
- valore invalido;
- regola violata.

---

# 25. Precisione numerica

I calcoli devono utilizzare una precisione sufficiente a evitare errori cumulativi nella simulazione.

Non arrotondare i valori mensili intermedi per finalità di visualizzazione.

L'arrotondamento deve essere applicato esclusivamente al frontend o alla serializzazione destinata alla visualizzazione, se necessario.

Le grandezze interne devono mantenere la precisione disponibile nel tipo numerico scelto dal progetto.

---

# 26. Validazione statistica futura

Quando verrà implementata la validazione dei rendimenti, dovranno essere confrontati almeno:

- expected return annuale configurato;
- expected return mensile teorico;
- rendimento mensile empirico;
- volatilità annuale configurata;
- volatilità mensile teorica;
- volatilità empirica;
- frequenza Reject & Redraw;
- distribuzione degli shock;
- frequenza di osservazioni vicine agli estremi;
- rendimento annualizzato emergente;
- benchmark general;
- long-term expected return.

Il sistema deve mostrare eventuali divergenze senza correggerle automaticamente.

---

# 27. Decisioni definitive del capitolo

- Il motore opera mensilmente.
- I parametri DB rimangono annualizzati.
- Non vengono introdotte nuove property o nuove colonne DB per la mensilizzazione.
- Expected return mensile mediante capitalizzazione composta.
- Formula: `(1 + annualExpectedReturn)^(1/12) - 1`.
- Non utilizzare `annualExpectedReturn / 12`.
- Deve valere `annualExpectedReturn > -1`.
- Volatility mensile mediante `annualVolatility / sqrt(12)`.
- Deve valere `annualVolatility >= 0`.
- Il return range è un intervallo di plausibilità.
- Il return range non viene diviso per 12.
- Il return range non viene trasformato mediante semplice capitalizzazione dei suoi estremi.
- Gli estremi vengono convertiti in z-score rispetto a expected return e volatility annuali.
- Gli z-score vengono mantenuti nel passaggio alla scala mensile.
- Prima avviene la mensilizzazione, poi viene applicata l'intensità.
- L'intensità modifica expected return e volatility mensili.
- Il range mensile effettivo viene ricostruito usando expected return effettivo, volatility effettiva e z-score.
- Se il rendimento estratto esce dal range si applica Reject & Redraw.
- Non utilizzare clamp.
- Le correlazioni non vengono mensilizzate.
- Max Drawdown non viene mensilizzato e non partecipa alla generazione.
- Long-term expected return resta annualizzato e diagnostico.
- I parametri general restano benchmark diagnostici.
- Le grandezze mensili indipendenti dall'intensità possono essere pre-calcolate.
- Le grandezze dipendenti dall'intensità vengono calcolate mese per mese.
- Le configurazioni incoerenti causano fail-fast.
- Nessun benchmark deve correggere automaticamente il risultato emergente della simulazione.
