# 11-ruolo-dell-intensita

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

---

# 1. Scopo

Questo capitolo definisce come l'intensità mensile del macro-scenario modifica i parametri di rendimento utilizzati dal Monte Carlo Engine.

Per ogni mese esiste:

- un solo macro-scenario corrente;
- una sola intensità dello scenario;
- la stessa intensità è condivisa da tutti gli ETF del portafoglio.

L'intensità è espressa nel dominio:

`0 <= intensity <= 1`

e viene applicata ai parametri già mensilizzati.

Non vengono introdotte nuove property DB.

---

# 2. Significato dell'intensità

L'intensità rappresenta quanto fortemente il macro-scenario corrente si manifesta nel mese.

Interpretazione:

- `0` = scenario presente con effetto direzionale nullo sul rendimento atteso;
- `1` = scenario pienamente espresso secondo i parametri censiti nel DB;
- valori intermedi = interpolazione lineare.

L'intensità non rappresenta una probabilità e non sostituisce la volatilità.

La distribuzione probabilistica con cui l'intensità viene estratta è definita nei capitoli precedenti dedicati alla dinamica degli scenari.

---

# 3. Validazione dell'intensità

Deve sempre valere:

`0 <= intensity <= 1`

Se arriva al motore un valore inferiore a 0 o superiore a 1:

- NON effettuare clamp;
- NON correggere automaticamente;
- effettuare fail-fast;
- produrre un errore diagnostico utile a individuare il bug nel generatore dell'intensità.

---

# 4. Ordine delle operazioni

Come stabilito nel capitolo 08:

`parametro annuale -> mensilizzazione -> applicazione intensità`

L'intensità viene quindi applicata ai parametri mensili e non direttamente ai parametri annuali.

---

# 5. Expected return

Dopo la mensilizzazione è disponibile:

`monthlyExpectedReturn`

L'expected return mensile effettivo è:

`effectiveMonthlyExpectedReturn = monthlyExpectedReturn * intensity`

La relazione è lineare.

Esempi:

- intensity 0.00 -> 0% dell'expected return dello scenario;
- intensity 0.25 -> 25%;
- intensity 0.50 -> 50%;
- intensity 0.75 -> 75%;
- intensity 1.00 -> 100%.

La stessa formula vale per expected return positivi e negativi.

Esempio positivo:

`monthlyExpectedReturn = +1%`

`intensity = 0.50`

`effectiveMonthlyExpectedReturn = +0.50%`

Esempio negativo:

`monthlyExpectedReturn = -1%`

`intensity = 0.50`

`effectiveMonthlyExpectedReturn = -0.50%`

---

# 6. Importante: intensità zero NON significa rendimento realizzato zero

L'intensità agisce sulla **media della distribuzione**, non sul rendimento mensile finale.

Con:

`intensity = 0`

si ottiene:

`effectiveMonthlyExpectedReturn = 0`

ma la volatilità NON diventa zero.

Il rendimento viene successivamente generato tramite lo shock casuale Student-t:

`monthlyReturn = effectiveMonthlyExpectedReturn + effectiveMonthlyVolatility * standardizedShock`

Di conseguenza, anche con expected return effettivo pari a zero, lo shock può produrre:

- rendimento positivo;
- rendimento negativo.

Questa distinzione è fondamentale:

`expected return = centro della distribuzione`

non:

`expected return = rendimento realizzato`

---

# 7. Volatility floor

La volatilità non deve annullarsi quando l'intensità è zero.

È definito un floor pari al:

`30%`

della volatility mensile dello scenario.

Non viene creata una property DB per questo valore.

La costante è definita a codice:

`VOLATILITY_INTENSITY_FLOOR = 0.30`

---

# 8. Formula della volatility effettiva

La volatility cresce linearmente dal 30% al 100% della volatility dello scenario:

`effectiveMonthlyVolatility = monthlyVolatility * (0.30 + 0.70 * intensity)`

Pertanto:

| Intensity | Quota volatility scenario |
|---:|---:|
| 0.00 | 30.0% |
| 0.25 | 47.5% |
| 0.50 | 65.0% |
| 0.75 | 82.5% |
| 1.00 | 100.0% |

La volatility non viene amplificata oltre il valore dello scenario.

---

# 9. Intensità 100%

Con:

`intensity = 1`

il motore utilizza integralmente i parametri mensilizzati dello scenario:

`effectiveMonthlyExpectedReturn = monthlyExpectedReturn`

`effectiveMonthlyVolatility = monthlyVolatility`

L'intensità non deve amplificare i parametri oltre i valori censiti.

---

# 10. Curva lineare

Sia expected return sia volatility utilizzano una trasformazione lineare.

Non utilizzare:

- curve esponenziali;
- curve quadratiche;
- sigmoid;
- coefficienti differenti per scenario;
- coefficienti differenti per ETF.

La non uniformità osservata delle intensità nel tempo deriva dalla distribuzione utilizzata per estrarre l'intensità, non dalla trasformazione successiva dei parametri.

---

# 11. Intensità condivisa

Per ogni mese esiste una sola intensità del macro-scenario.

Esempio:

`scenario = RECESSION`

`intensity = 0.72`

Tutti gli ETF ricevono:

`intensity = 0.72`

Ogni ETF reagisce diversamente perché possiede propri:

- expected return dello scenario;
- volatility dello scenario;
- return range;
- correlazioni.

Non generare intensità specifiche per ETF.

---

# 12. Return range

L'intensità non viene moltiplicata direttamente per `return_range.min` e `return_range.max`.

Come stabilito nel capitolo 08, dopo aver calcolato:

- `effectiveMonthlyExpectedReturn`;
- `effectiveMonthlyVolatility`;

il range viene ricostruito mantenendo gli z-score annuali:

`effectiveMonthlyRangeMin = effectiveMonthlyExpectedReturn + zMin * effectiveMonthlyVolatility`

`effectiveMonthlyRangeMax = effectiveMonthlyExpectedReturn + zMax * effectiveMonthlyVolatility`

---

# 13. Relazione con lo shock Student-t

L'intensità determina il centro e la scala effettivi della distribuzione mensile.

Successivamente viene applicato lo shock Student-t standardizzato definito nel capitolo 09.

Schema:

`scenario`

-> `monthlyExpectedReturn + monthlyVolatility`

-> `intensity`

-> `effectiveMonthlyExpectedReturn + effectiveMonthlyVolatility`

-> `Student-t standardized shock`

-> `monthlyReturn`

-> `return range validation`

---

# 14. Esempio concettuale: perché sono possibili rendimenti negativi in Expansion

Supponiamo che un ETF in Expansion abbia un return range annuale:

`[-10%, +30%]`

e un expected return positivo.

L'intensità NON seleziona direttamente un punto compreso tra -10% e +30%.

L'intensità modifica il centro della distribuzione.

A intensity 0:

`effective expected return = 0`

ma:

`effective volatility = 30% della volatility dello scenario`

La Student-t produce quindi shock sia positivi sia negativi.

Un shock negativo può generare un rendimento mensile negativo anche durante Expansion.

Aumentando l'intensità:

- il centro della distribuzione si sposta progressivamente verso l'expected return positivo dello scenario;
- la volatility aumenta progressivamente;
- continuano comunque a essere possibili rendimenti negativi, compatibilmente con il return range.

Quindi Expansion non significa che ogni mese debba essere positivo.

Analogamente, Recession non significa che ogni mese debba essere negativo.

---

# 15. Nessun nuovo parametro DB

Non creare nuove property per:

- volatility floor;
- curva dell'expected return;
- curva della volatility.

Utilizzare a codice:

`VOLATILITY_INTENSITY_FLOOR = 0.30`

Le formule sono parte della specifica del motore.

---

# 16. Diagnostica futura

Nella pagina Statistics dovrà essere possibile verificare il comportamento per fasce di intensità.

Prevedere almeno fasce:

- 0-20%;
- 20-40%;
- 40-60%;
- 60-80%;
- 80-100%.

Per ogni fascia sarà utile confrontare:

- intensità media;
- expected return effettivo medio;
- volatility effettiva media;
- rendimento empirico medio;
- volatility empirica;
- frequenza rendimenti negativi;
- frequenza rendimenti positivi;
- reject rate.

Questo consentirà di verificare che l'intensità produca effettivamente il comportamento previsto.

---

# 17. Decisioni definitive

- Intensità compresa tra 0 e 1.
- Valori fuori dominio causano fail-fast.
- Nessun clamp.
- L'intensità viene applicata dopo la mensilizzazione.
- Expected return: trasformazione lineare.
- `effectiveMonthlyExpectedReturn = monthlyExpectedReturn * intensity`.
- Intensity 0 -> expected return effettivo 0.
- Intensity 1 -> expected return completo dello scenario.
- Volatility floor = 30% della volatility dello scenario.
- Floor definito a codice.
- Nessuna nuova property DB.
- Volatility: trasformazione lineare.
- `effectiveMonthlyVolatility = monthlyVolatility * (0.30 + 0.70 * intensity)`.
- Intensity 0 -> 30% della volatility.
- Intensity 1 -> 100% della volatility.
- Nessuna amplificazione oltre i parametri dello scenario.
- Stessa intensità per tutti gli ETF del mese.
- Return range ricostruito tramite z-score dopo l'applicazione dell'intensità.
- Expected return zero non implica rendimento realizzato zero.
- I rendimenti positivi e negativi derivano anche dallo shock Student-t.
