# 14-correzione-delle-matrici-non-valide

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

---

# 1. Scopo

Questo capitolo definisce il comportamento del Monte Carlo Engine quando una matrice di correlazione costruita secondo il capitolo 13 risulta non Positive Semi-Definite (non PSD).

L'obiettivo è consentire una correzione automatica solo quando la matrice è molto vicina a una matrice valida, mantenendo massima trasparenza e impedendo modifiche sostanziali dei coefficienti censiti nel database.

Il capitolo riguarda esclusivamente:

- rilevazione della necessità di correzione;
- applicazione dell'algoritmo nearest correlation matrix;
- limiti massimi di intervento;
- validazione della matrice corretta;
- diagnostica.

Non riguarda:

- generazione degli shock correlati;
- copula;
- validazione empirica delle correlazioni.

---

# 2. Principio generale

Una matrice viene corretta automaticamente soltanto se:

1. è già stata costruita e validata strutturalmente secondo il capitolo 13;
2. tutti i coefficienti sono presenti e validi;
3. la matrice è simmetrica;
4. la diagonale è unitaria;
5. i coefficienti sono in `[-1,+1]`;
6. la matrice è non PSD oltre la tolleranza tecnica prevista;
7. la correzione richiesta resta entro il limite massimo ammesso.

Le matrici già PSD non devono essere modificate.

---

# 3. Trigger della correzione

Dal capitolo 13:

`PSD_EPSILON = 1e-6`

Calcolare:

`lambdaMin = minimumEigenvalue(matrix)`

Regola:

`lambdaMin >= -1e-6`

-> matrice considerata PSD  
-> nessuna correzione

`lambdaMin < -1e-6`

-> matrice non PSD  
-> tentare la correzione automatica

---

# 4. Algoritmo di correzione

Utilizzare un algoritmo:

**Nearest Correlation Matrix**

preferibilmente secondo l'impostazione di Higham o algoritmo matematicamente equivalente.

L'obiettivo è ottenere una matrice:

- simmetrica;
- PSD;
- con diagonale esattamente uguale a 1;
- il più possibile vicina alla matrice originale.

Non utilizzare correzioni euristiche non documentate.

Non utilizzare semplicemente clamp o modifica manuale di singole celle.

---

# 5. Diagonale

La diagonale deve rimanere:

`matrix[i][i] = 1`

sia prima sia dopo la correzione.

La procedura nearest correlation matrix deve preservare o ripristinare esattamente la diagonale unitaria.

Qualunque matrice corretta con diagonale diversa da 1 è invalida.

---

# 6. Correzione separata per macro-scenario

Le quattro matrici vengono trattate indipendentemente:

- Expansion;
- Soft Landing;
- Recession;
- Stagflation.

Una matrice valida non deve essere modificata perché un altro scenario richiede correzione.

La correzione dello scenario A non deve influenzare i coefficienti degli altri scenari.

---

# 7. Nessun salvataggio nel database

La matrice corretta esiste esclusivamente a runtime.

NON:

- aggiornare `etf_correlations`;
- sovrascrivere i coefficienti originali;
- creare nuovi record;
- salvare la matrice corretta come configurazione permanente.

Il database rimane la fonte originale.

La correzione deve essere sempre ricostruibile e visibile nella diagnostica.

---

# 8. Limite massimo di correzione

La correzione automatica è accettabile soltanto se nessuna singola correlazione viene modificata di più di:

`MAX_CORRELATION_CELL_DELTA = 0.02`

Il valore è fisso a codice.

Non creare una property DB.

Il limite rappresenta:

**2 punti assoluti di correlazione**

Esempio ammesso:

`0.600 -> 0.618`

Delta:

`0.018`

Esempio NON ammesso:

`0.600 -> 0.625`

Delta:

`0.025`

---

# 9. Calcolo del delta cella per cella

Per ogni coppia fuori diagonale:

`cellDelta[i][j] = corrected[i][j] - original[i][j]`

Calcolare:

`absoluteCellDelta[i][j] = abs(cellDelta[i][j])`

Poi:

`maxCellDelta = max(absoluteCellDelta[i][j])`

considerando le celle fuori diagonale.

Regola:

`maxCellDelta <= 0.02`

-> correzione potenzialmente accettabile

`maxCellDelta > 0.02`

-> correzione NON accettabile  
-> fail-fast

---

# 10. Norma di Frobenius

Calcolare anche la distanza complessiva tra matrice originale e corretta tramite norma di Frobenius:

`frobeniusDelta = ||corrected - original||_F`

Questa metrica è diagnostica.

Non viene utilizzata come soglia di KO nella prima versione.

Serve a valutare quanto globalmente la matrice è stata modificata.

---

# 11. Validazione dopo la correzione

Dopo la procedura nearest correlation matrix rieseguire tutte le validazioni rilevanti.

La matrice corretta deve rispettare:

- simmetria;
- diagonale = 1;
- coefficienti in `[-1,+1]`;
- PSD entro `PSD_EPSILON = 1e-6`.

Calcolare nuovamente:

- tutti gli autovalori;
- minimum eigenvalue;
- condition number, quando disponibile.

---

# 12. Correzione fallita

La correzione è considerata fallita se si verifica almeno una delle condizioni seguenti:

- algoritmo non converge;
- risultato non finito;
- valori NaN;
- valori Infinity;
- diagonale diversa da 1;
- perdita di simmetria;
- coefficienti fuori `[-1,+1]`;
- minimum eigenvalue < `-1e-6`;
- `maxCellDelta > 0.02`.

In uno di questi casi:

**LA SIMULAZIONE NON PARTE.**

Non tentare ulteriori correzioni euristiche.

---

# 13. Matrice PSD ma mal condizionata

Se una matrice è PSD entro la tolleranza:

`lambdaMin >= -1e-6`

non deve essere corretta automaticamente anche se il condition number è elevato.

Il condition number resta una metrica diagnostica.

La stabilità numerica necessaria per la generazione degli shock verrà trattata nel capitolo dedicato.

---

# 14. Nessuna modifica delle matrici già valide

È vietato utilizzare l'algoritmo nearest correlation matrix come normalizzazione generale.

Applicarlo esclusivamente alle matrici che risultano realmente non PSD oltre la tolleranza.

Una matrice valida deve rimanere identica al dato costruito dal DB.

---

# 15. Nessun clamp dei coefficienti

Non correggere singole correlazioni con:

`rho = min(1, max(-1, rho))`

I coefficienti fuori range sono errori strutturali già gestiti dal capitolo 13 e devono causare fail-fast.

Il capitolo 14 interviene esclusivamente su incoerenze PSD di una matrice che è strutturalmente valida.

---

# 16. Nessuna correzione di dati mancanti

La nearest correlation matrix non deve essere utilizzata per:

- stimare correlazioni mancanti;
- sostituire null;
- completare coppie non censite.

Una matrice incompleta non arriva al capitolo 14.

Viene bloccata prima dal capitolo 13.

---

# 17. Struttura runtime

Per ciascun macro-scenario conservare concettualmente:

```text
CorrelationMatrixValidationResult {
    scenario
    assetIsins[]
    originalMatrix[][]
    correctedMatrix[][]
    correctionApplied
    minimumEigenvalueBefore
    minimumEigenvalueAfter
    maxCellDelta
    frobeniusDelta
    conditionNumberBefore
    conditionNumberAfter
}
```

Se nessuna correzione viene applicata:

`correctionApplied = false`

e la matrice operativa coincide con quella originale.

---

# 18. Matrice operativa

Definire una matrice operativa per scenario:

```text
operationalMatrix =
    correctionApplied
    ? correctedMatrix
    : originalMatrix
```

Solo la matrice operativa viene passata ai capitoli successivi per la generazione degli shock correlati.

---

# 19. Statistics

La pagina Statistics deve mostrare per ogni scenario:

- PSD originale OK/KO;
- minimum eigenvalue originale;
- correzione applicata sì/no;
- matrice originale;
- matrice corretta, se presente;
- matrice dei delta cella per cella;
- `maxCellDelta`;
- `MAX_CORRELATION_CELL_DELTA = 0.02`;
- `frobeniusDelta`;
- minimum eigenvalue dopo correzione;
- PSD dopo correzione;
- condition number prima;
- condition number dopo;
- numero iterazioni dell'algoritmo, se disponibile;
- stato finale: VALID / CORRECTED / FAILED.

Non nascondere le modifiche apportate.

---

# 20. Visualizzazione dei delta

La pagina Statistics deve rendere facilmente individuabili le celle modificate.

Per ogni coppia mostrare almeno:

- correlazione originale;
- correlazione corretta;
- delta assoluto.

Quando possibile utilizzare una heatmap dei delta.

La visualizzazione non deve modificare alcun dato.

---

# 21. Errori

In caso di correzione non accettabile restituire un errore puntuale.

Esempio concettuale:

```text
CORRELATION_MATRIX_CORRECTION_TOO_LARGE
scenario=RECESSION
maxCellDelta=0.027
allowedMaxCellDelta=0.020
```

Oppure:

```text
CORRELATION_MATRIX_CORRECTION_FAILED
scenario=STAGFLATION
minimumEigenvalueAfter=-0.0032
epsilon=0.000001
```

Quando disponibile indicare anche la coppia che ha subito il maggiore delta.

---

# 22. Nessun fallback successivo

Se la nearest correlation matrix fallisce o produce una modifica superiore al limite:

NON:

- aumentare automaticamente il limite;
- aggiungere jitter alla diagonale;
- utilizzare una matrice identità;
- utilizzare la matrice di un altro scenario;
- eliminare ETF;
- ridurre coefficienti arbitrariamente.

Il comportamento corretto è fail-fast.

---

# 23. Prestazioni

La correzione viene eseguita:

- una volta per scenario;
- prima del loop Monte Carlo;
- solo se necessaria.

Non deve essere eseguita per ogni mese o per ogni percorso.

Il costo computazionale è quindi marginale rispetto alla simulazione completa.

---

# 24. Confini con i capitoli successivi

Questo capitolo produce matrici operative valide.

Il capitolo 15 utilizzerà tali matrici per generare shock correlati.

Il capitolo 16 definirà il modello di dipendenza/copula.

Il capitolo 17 controllerà se le correlazioni empiriche ottenute corrispondono sufficientemente a quelle operative.

La correzione PSD non deve anticipare queste responsabilità.

---

# 25. Decisioni definitive

- Correggere automaticamente solo matrici non PSD.
- Matrici PSD entro `1e-6` non vengono modificate.
- Algoritmo: nearest correlation matrix, preferibilmente Higham.
- Diagonale sempre esattamente 1.
- Correzione separata per ciascun macro-scenario.
- Nessuna persistenza della matrice corretta nel DB.
- Correzione solo runtime.
- `MAX_CORRELATION_CELL_DELTA = 0.02`.
- Il limite è fisso a codice.
- 0.02 significa 2 punti assoluti di correlazione.
- Calcolare delta cella per cella.
- Calcolare `maxCellDelta`.
- Calcolare anche la norma di Frobenius come diagnostica.
- Se `maxCellDelta > 0.02`, fail-fast.
- Dopo la correzione rieseguire validazioni complete.
- Se la matrice corretta non è PSD, fail-fast.
- Se l'algoritmo non converge, fail-fast.
- Nessuna correzione di matrici PSD ma mal condizionate.
- Condition number solo diagnostico.
- Nessun clamp.
- Nessuna stima di correlazioni mancanti.
- Nessun fallback.
- Conservare matrice originale e corretta per diagnostica.
- Passare ai capitoli successivi solo la matrice operativa valida.
- Mostrare integralmente la correzione nella pagina Statistics.

## Addendum v1.1 - algoritmo nearest correlation deterministico

L'espressione "preferibilmente Higham o equivalente" viene sostituita, per la v1.1, da una scelta univoca:

**utilizzare l'algoritmo di Higham con alternating projections e correzione di Dykstra.**

Input:

`A = originalCorrelationMatrix`

Inizializzazione:

`Y0 = A`

`deltaS0 = 0`

Per ogni iterazione `k = 1..MAX_ITERATIONS`:

1. `Rk = Y(k-1) - deltaS(k-1)`
2. proiettare `Rk` sul cono PSD tramite eigendecomposition simmetrica:
   - `Rk = Q * diag(lambda) * Q^T`
   - sostituire ogni `lambda_i < 0` con `0`
   - `Xk = Q * diag(max(lambda_i, 0)) * Q^T`
3. `deltaSk = Xk - Rk`
4. proiettare `Xk` sull'insieme delle matrici con diagonale unitaria:
   - `Yk = Xk`
   - impostare esattamente `Yk[i][i] = 1`
   - risimmetrizzare numericamente con `(Yk + Yk^T) / 2`
5. calcolare:
   `relativeChange = ||Yk - Y(k-1)||_F / max(1, ||Yk||_F)`
6. se `relativeChange <= NEAREST_CORRELATION_TOLERANCE`, terminare.

Costanti fisse:

`NEAREST_CORRELATION_TOLERANCE = 1e-10`

`NEAREST_CORRELATION_MAX_ITERATIONS = 100`

Dopo la convergenza eseguire integralmente le validazioni già previste dal capitolo, incluse:
- simmetria;
- diagonale esattamente 1;
- coefficienti in `[-1,1]`;
- minimum eigenvalue `>= -PSD_EPSILON`;
- `maxCellDelta <= 0.02`.

Non applicare jitter, ridge, clamp delle celle fuori diagonale o ulteriori "repair" euristici.

Se l'algoritmo non converge entro 100 iterazioni o fallisce una validazione finale, fail-fast.

Il limite:

`MAX_CORRELATION_CELL_DELTA = 0.02`

era già parte della specifica v1.0 ed è **confermato**, non introdotto da VS Code.
