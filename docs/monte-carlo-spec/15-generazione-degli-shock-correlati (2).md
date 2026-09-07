# 15-generazione-degli-shock-correlati

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

## 1. Scopo

Definire come generare, per ogni mese e percorso, un vettore simultaneo di shock correlati per tutti gli ETF attivi, usando le matrici operative validate nei capitoli 13-14.

La scelta definitiva della copula resta al capitolo 16; la verifica empirica delle correlazioni resta al capitolo 17.

## 2. Unità di estrazione

L'unità di estrazione è:

`un percorso × un mese × tutti gli ETF attivi contemporaneamente`

Con N ETF:

`Z(t) = [z1, z2, ..., zN]`

Non simulare gli ETF separatamente per poi correlare i rendimenti.

## 3. Principio architetturale

La correlazione viene applicata alla componente casuale prima della costruzione dei rendimenti:

`variabili latenti indipendenti -> dipendenza/correlazione -> variabili latenti correlate -> trasformazione marginale -> shock -> rendimento`

È vietato:

`rendimenti indipendenti -> correzione a posteriori per imporre correlazione`

Il rendimento finale resta:

`R_i = muEffective_i + sigmaEffective_i * shock_i`

## 4. Ordine degli ETF

L'ordine del vettore deve coincidere esattamente con `assetIsins[]` della matrice operativa.

`matrix[i][j]`, `shock[i]` e i parametri dell'ETF `i` devono riferirsi sempre allo stesso ISIN.

## 5. Matrice operativa

Per ciascuno scenario utilizzare esclusivamente la matrice operativa prodotta dai capitoli 13-14:

`operationalMatrix = correctedMatrix se correctionApplied, altrimenti originalMatrix`

Il capitolo 15 non modifica i coefficienti.

## 6. Fattorizzazione

Usare come metodo generale l'eigendecomposition:

`R = Q * Lambda * Q^T`

Costruire:

`A = Q * sqrt(Lambda)`

così che:

`A * A^T ≈ R`

Questa soluzione consente di gestire matrici PSD anche singolari senza introdurre jitter per renderle artificialmente Positive Definite.

## 7. Autovalori entro la tolleranza

Vale:

`PSD_EPSILON = 1e-6`

Se:

`-PSD_EPSILON <= lambda < 0`

durante la fattorizzazione numerica è ammesso trattare l'autovalore come zero.

Se:

`lambda < -PSD_EPSILON`

effettuare fail-fast: la matrice non avrebbe dovuto raggiungere il capitolo 15.

## 8. Precalcolo

Precalcolare una sola volta prima del loop Monte Carlo:

- factorExpansion;
- factorSoftLanding;
- factorRecession;
- factorStagflation.

Non effettuare eigendecomposition per percorso, anno, mese o redraw.

## 9. Validazione del fattore

Dopo la fattorizzazione verificare:

`A * A^T ≈ R`

Una discrepanza numericamente significativa causa fail-fast con indicazione dello scenario e dell'errore di ricostruzione.

## 10. Selezione per scenario

Ogni mese usa immediatamente il fattore dello scenario corrente.

Se lo scenario passa da Expansion a Recession, dal primo mese Recession si utilizza `factorRecession`.

Non interpolare matrici o fattori tra scenari.

L'inerzia macro è già gestita dalla logica degli scenari.

## 11. Intensità

L'intensità non modifica correlazioni, matrici o fattori.

Recession con intensità 0.20 e Recession con intensità 1.00 utilizzano la stessa struttura di correlazione.

L'intensità modifica mu e sigma secondo il capitolo 11.

## 12. Variabili latenti e confine col capitolo 16

Il capitolo 15 definisce la meccanica matriciale ma non fissa ancora definitivamente la distribuzione delle variabili latenti.

Pipeline:

`independentLatentVector -> correlationFactor -> correlatedLatentVector -> capitolo 16 -> Student-t marginal shocks`

Non adottare come soluzione definitiva la scorciatoia:

`Student-t indipendenti -> moltiplicazione lineare per A`

perché non garantisce automaticamente marginali Student-t e dipendenza desiderata.

## 13. Applicazione della trasformazione

Struttura generale:

`C = A * U`

dove `U` è il vettore latente indipendente e `C` quello correlato.

Il significato probabilistico definitivo di U e la trasformazione marginale successiva vengono definiti nel capitolo 16.

## 14. Correlazioni estreme

`rho = +1` e `rho = -1` restano ammessi.

Possono produrre matrici PSD singolari, gestibili tramite eigendecomposition.

Non introdurre limiti artificiali ±0.999.

## 15. Reject & Redraw multivariato

Dopo la costruzione dei rendimenti candidati, validare contemporaneamente tutti gli ETF.

Se anche un solo ETF viola il proprio effective return range o un hard constraint:

**rifiutare l'intero vettore del mese.**

Non riestrarre soltanto l'ETF non valido, perché questo altererebbe la struttura di dipendenza.

## 16. MAX_REDRAWS

`MAX_REDRAWS = 1000`

indica massimo 1000 tentativi del vettore completo per quello specifico mese/percorso.

Non significa 1000 tentativi indipendenti per ETF.

Dopo 1000 tentativi senza vettore valido: fail-fast.

## 17. Diagnostica del fallimento

In caso di fallimento riportare almeno:

- percorso;
- mese;
- scenario;
- intensità;
- numero ETF;
- numero tentativi;
- ETF che hanno causato o concorso più frequentemente ai reject;
- effective return range rilevanti.

Un vettore può essere rifiutato contemporaneamente da più ETF.

## 18. Statistics dei vector redraw

Mostrare almeno:

- vettori generati;
- vettori accettati;
- vettori rifiutati;
- vector reject rate;
- tentativi medi;
- mediana tentativi;
- P95 tentativi;
- massimo tentativi;
- reject cause count per ETF;
- reject cause rate per ETF.

Separare i risultati per macro-scenario e per fasce di intensità:

- 0-20%;
- 20-40%;
- 40-60%;
- 60-80%;
- 80-100%.

## 19. Diagnostica della fattorizzazione

Per ogni scenario mostrare nella Statistics:

- matrice operativa;
- autovalori;
- eventuali autovalori entro epsilon portati numericamente a zero;
- fattore;
- errore di ricostruzione `A*A^T - R`;
- stato OK/KO.

## 20. ETF singolo

Con un solo ETF la matrice è `[1]` e il fattore è `[1]`.

Il processo degenera naturalmente al caso univariato.

## 21. Prestazioni

La fattorizzazione avviene esclusivamente all'inizializzazione.

Nel loop mensile si esegue la trasformazione del vettore usando il fattore precalcolato.

Un redraw non deve mai causare una nuova eigendecomposition.

## 22. Fail-fast

Interrompere la simulazione almeno in caso di:

- matrice operativa non PSD oltre epsilon;
- autovalori NaN/Infinity;
- fattore NaN/Infinity;
- errore di ricostruzione oltre tolleranza;
- mismatch dimensione matrice/ETF;
- mismatch nell'ordine o identità degli ETF;
- impossibilità di ottenere un vettore valido entro 1000 tentativi.

Nessuna correzione silenziosa.

## 23. Confine con i capitoli 16 e 17

Il capitolo 16 decide come combinare correttamente:

- marginali Student-t con nu=5;
- struttura di correlazione desiderata;
- variabili latenti;
- Gaussian copula, t-copula o altra soluzione;
- comportamento delle code;
- correlazione Pearson target.

Il capitolo 17 verifica empiricamente:

- correlazioni target;
- correlazioni operative;
- correlazioni degli shock;
- correlazioni dei rendimenti.

## 24. Decisioni definitive

- Un vettore simultaneo per tutti gli ETF/mese/percorso.
- Ordine vettore identico all'ordine della matrice.
- Matrice operativa dai capitoli 13-14.
- Eigendecomposition come fattorizzazione generale.
- Compatibilità con matrici PSD singolari.
- Autovalori negativi entro 1e-6 trattabili numericamente come zero.
- Autovalori sotto -1e-6: fail-fast.
- Quattro fattori precalcolati.
- Validazione `A*A^T ≈ R`.
- Cambio immediato del fattore quando cambia scenario.
- Nessuna interpolazione tra scenari.
- Intensità non modifica le correlazioni.
- Correlazione applicata alla componente casuale, non ai rendimenti già costruiti.
- Copula definitiva rinviata al capitolo 16.
- Correlazioni ±1 ammesse.
- Reject & Redraw dell'intero vettore.
- Se un ETF fallisce, fallisce tutto il vettore.
- MAX_REDRAWS=1000 sul vettore completo.
- Fallimento dopo 1000 tentativi: fail-fast.
- Diagnostica dei reject per ETF, scenario e intensità.
- Nessuna eigendecomposition nel loop mensile.
- Verifica empirica definitiva rinviata al capitolo 17.
