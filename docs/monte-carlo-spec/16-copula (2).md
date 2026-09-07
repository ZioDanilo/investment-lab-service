# 16-copula

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

## 1. Scopo
Definire il modello di dipendenza probabilistica che combina marginali Student-t degli ETF e correlazioni scenario-specifiche. La scelta è una **t-copula con ν=5 fisso a codice**.

## 2. Parametri fissi
- `COPULA_DF = 5`
- `COPULA_EPSILON = 1e-12`
- `TAIL_DEPENDENCE_LEVEL = 0.05`

Nessuno di questi valori richiede property DB o input frontend. ν è identico per tutti gli ETF e tutti i macro-scenari.

## 3. Marginali
Le marginali definite nel capitolo 9 restano invariate: Student-t ν=5 standardizzate a varianza 1.

`standardizedShock = rawStudentT * sqrt(3/5)`

La copula introduce dipendenza; non modifica la distribuzione marginale decisa in precedenza.

## 4. Significato delle correlazioni DB
I coefficienti di `etf_correlations` rappresentano il **target Pearson dei rendimenti finali** nello specifico macro-scenario.

Mantenere distinti:
- `targetCorrelation`
- `operationalCorrelation`
- `latentCorrelation`
- `empiricalCorrelation`

La operational correlation è quella prodotta dai capitoli 13-14.

Nella versione corrente:

`latentCorrelation = operationalCorrelation`

La separazione deve comunque esistere nell'architettura per consentire una futura calibrazione.

## 5. Calibrazione rinviata
Non implementare ora un algoritmo che modifichi la latent correlation per forzare la Pearson finale al target.

L'eventuale calibrazione sarà valutata nel capitolo 17 o successivamente, oppure potrà non essere implementata se i test empirici mostreranno scostamenti accettabili.

## 6. Pipeline t-copula
Per ogni percorso × mese × tentativo di redraw:

```text
1. genera N normali indipendenti
2. applica il fattore della latent correlation matrix
3. ottieni normali correlate
4. genera un unico fattore chi-quadro comune W
5. costruisci variabili t correlate
6. applica CDF Student-t
7. ottieni uniformi correlate
8. applica inverse CDF Student-t ν=5
9. standardizza le marginali a varianza 1
10. costruisci i rendimenti candidati
11. valida e applica Reject & Redraw
```

## 7. Normali correlate
Generare:

`G = [g1,...,gN]`, con `g_i ~ N(0,1)` indipendenti.

Applicare il fattore precalcolato:

`Y = A * G`

con:

`A * A^T ≈ latentCorrelationMatrix`

L'ordine degli ETF deve coincidere esattamente con quello della matrice.

## 8. Fattore chi-quadro comune
Per ogni vettore/tentativo generare un solo:

`W ~ χ²(5)`

W è condiviso da tutti gli ETF del vettore. Non generare un W indipendente per ETF.

Costruire:

`T_i = Y_i / sqrt(W/5)`

Il fattore comune è essenziale per la dipendenza nelle code della t-copula.

## 9. Uniformi correlate
Per ogni componente:

`U_i = CDF_t5(T_i)`

Applicare protezione numerica:

`U_i = clamp(U_i, 1e-12, 1 - 1e-12)`

Questo clamp serve esclusivamente a proteggere inverse CDF da 0/1 numerici; non è un clamp economico di shock o rendimenti.

## 10. Marginali finali
Calcolare:

`rawMarginalShock_i = inverseCDF_t5(U_i)`

poi:

`marginalShock_i = rawMarginalShock_i * sqrt(3/5)`

Ogni marginale finale deve quindi conservare Student-t ν=5 e varianza teorica unitaria.

## 11. Rendimento ETF
Solo dopo la costruzione degli shock correlati:

`monthlyReturn_i = effectiveMonthlyExpectedReturn_i + effectiveMonthlyVolatility_i * marginalShock_i`

La correlazione agisce sulla componente casuale, non su rendimenti già generati.

## 12. Reject & Redraw
Resta integralmente valida la logica del capitolo 15.

Se anche un solo ETF viola effective return range o hard constraint, rifiutare l'intero vettore.

In caso di redraw rigenerare tutto:
- normali indipendenti;
- vettore correlato;
- W comune;
- variabili t;
- uniformi;
- shock;
- rendimenti.

Non riutilizzare elementi casuali del tentativo precedente.

`MAX_REDRAWS = 1000`

Dopo 1000 tentativi falliti: fail-fast.

## 13. Tail dependence
Misurare empiricamente la dipendenza nelle code nella pagina Statistics.

Per ogni coppia ETF e scenario mostrare almeno:

**Lower tail 5%**

`P(B <= Q5_B | A <= Q5_A)`

**Upper tail 5%**

`P(B >= Q95_B | A >= Q95_A)`

Quando utile mostrare anche le misure condizionate nella direzione inversa.

Non introdurre il livello 1%.

## 14. Statistics
Per ciascun macro-scenario mostrare almeno:
- tipo copula: t-copula;
- `COPULA_DF = 5`;
- `COPULA_EPSILON = 1e-12`;
- operational correlation matrix;
- latent correlation matrix;
- evidenza che attualmente latent = operational;
- lower-tail co-occurrence 5% per coppia;
- upper-tail co-occurrence 5% per coppia;
- diagnostica delle marginali Student-t;
- vector reject rate.

Mantenere distinti target, operational, latent ed empirical correlation.

## 15. Controlli strutturali
Fail-fast almeno in caso di:
- W non finito o <=0 per errore runtime/numerico;
- variabili latenti NaN/Infinity;
- CDF NaN;
- inverse CDF NaN/Infinity dopo epsilon;
- mismatch dimensionale;
- incoerenza nell'ordine degli ETF.

Nessuna correzione silenziosa.

## 16. Prestazioni
Il fattore della matrice resta precalcolato come definito nel capitolo 15.

Durante ogni redraw non rifattorizzare la matrice.

## 17. Decisioni definitive
- t-copula.
- ν=5 fisso a codice.
- ν identico per tutti gli ETF e scenari.
- Marginali del capitolo 9 invariate.
- Standardizzazione `sqrt(3/5)`.
- DB = target Pearson dei rendimenti finali.
- Distinguere target, operational, latent ed empirical correlation.
- Per ora `latentCorrelation = operationalCorrelation`.
- Nessuna calibrazione latente in questa fase.
- Un solo `W ~ χ²(5)` comune a tutto il vettore.
- `COPULA_EPSILON = 1e-12`.
- Reject & Redraw completo del vettore.
- Rigenerare W a ogni redraw.
- `MAX_REDRAWS = 1000`.
- Tail dependence misurata al 5% soltanto.
- Lower-tail e upper-tail dependence nella Statistics.
- Nessuna nuova configurazione DB per ν, epsilon o tail level.
- L'eventuale calibrazione latent/target resta una decisione futura.
