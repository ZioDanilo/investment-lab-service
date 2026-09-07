# 17-controllo-delle-correlazioni-empiriche

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

## 1. Scopo
Chiudere il blocco Correlazioni verificando empiricamente che la pipeline dei capitoli 13-16 produca la dipendenza attesa. Il capitolo misura e diagnostica: non corregge, non calibra e non genera fail-fast per semplici scostamenti statistici.

La metrica economica principale è la **Pearson correlation dei rendimenti mensili finali**.

## 2. Livelli da misurare
Calcolare la correlazione empirica a tre livelli:
1. variabili latenti correlate;
2. shock Student-t finali;
3. rendimenti mensili finali.

I rendimenti finali sono il riferimento principale.

Per ogni coppia rendere leggibile la pipeline:

`target -> operational -> latent -> empirical latent -> empirical shock -> empirical return`

## 3. Pearson e Spearman
Pearson è la metrica primaria perché `etf_correlations` contiene target Pearson dei rendimenti finali.

Per ogni coppia:

`delta = empiricalReturnPearson - targetPearson`

`absoluteDelta = abs(delta)`

Calcolare anche Spearman come diagnostica della dipendenza monotona. Spearman non determina OK/KO.

## 4. Analisi per macro-scenario
Produrre matrici separate per:
- Expansion;
- Soft Landing;
- Recession;
- Stagflation.

Ogni scenario va confrontato con il proprio target.

Calcolare inoltre una **General empirical correlation** aggregata, esclusivamente informativa. Non usarla come sostituto dei confronti scenario-specifici.

## 5. Campione statistico
Usare il banco prova già definito:
- 10.000 percorsi;
- 50 anni;
- 12 mesi/anno.

Non creare una simulazione separata dedicata alle correlazioni.

## 6. Analisi per intensità
Dentro ogni scenario misurare anche le correlazioni per:
- 0-20%;
- 20-40%;
- 40-60%;
- 60-80%;
- 80-100%.

Poiché il target non cambia con l'intensità, questa segmentazione serve a rilevare distorsioni indirette introdotte da volatility scaling, return range, trasformazioni marginali o Reject & Redraw.

## 7. Quattro concetti distinti
Mantenere separati:
- `targetCorrelation`: valore desiderato DB;
- `operationalCorrelation`: valore dopo validazione/eventuale correzione PSD;
- `latentCorrelation`: valore usato dalla copula;
- `empiricalCorrelation`: valore osservato.

Nella versione corrente:

`latentCorrelation = operationalCorrelation`

## 8. Nessuna soglia KO iniziale
Non definire inizialmente:
- tolleranza massima;
- soglia WARNING;
- soglia ERROR;
- fail-fast basato sul delta empirico.

Gli scostamenti sono risultati statistici da osservare. Le soglie potranno essere decise dopo i primi test reali.

## 9. Nessuna calibrazione automatica
Il capitolo 17 non modifica operational correlation, latent correlation, matrici DB o matrici runtime.

Non implementare cicli del tipo:

`target 0.75 -> empirical 0.68 -> aumenta latent -> riesegui`

Il capitolo è un **misuratore, non un calibratore**.

L'eventuale calibrazione verrà valutata successivamente e potrebbe anche non essere necessaria.

## 10. Tail dependence
Integrare le misure già definite nel capitolo 16 usando solo:

`TAIL_DEPENDENCE_LEVEL = 0.05`

Per ogni coppia/scenario misurare:

**Lower tail 5%**

`P(B <= Q5_B | A <= Q5_A)`

e, quando utile, la misura inversa.

**Upper tail 5%**

`P(B >= Q95_B | A >= Q95_A)`

e, quando utile, la misura inversa.

Non introdurre il livello 1% e non definire ancora soglie OK/KO.

## 11. Metriche per coppia
Per ogni coppia ETF mostrare almeno:
- ETF A;
- ETF B;
- scenario;
- target correlation;
- operational correlation;
- latent correlation;
- empirical latent Pearson;
- empirical shock Pearson;
- empirical return Pearson;
- empirical return Spearman;
- correlation delta;
- absolute correlation delta;
- lower-tail 5%;
- upper-tail 5%;
- sample size.

## 12. Metriche globali per scenario
Sulle coppie fuori diagonale calcolare:

`MAE = mean(abs(empirical_ij - target_ij))`

`RMSE = sqrt(mean((empirical_ij - target_ij)^2))`

`MAX_ERROR = max(abs(empirical_ij - target_ij))`

Mostrare anche la coppia responsabile del Max Absolute Error.

MAE, RMSE e Max Error sono inizialmente solo diagnostici e non hanno soglie di fallimento.

## 13. Statistics - vista scenario
Per ogni scenario mostrare almeno:
- target correlation matrix;
- operational correlation matrix;
- latent correlation matrix;
- empirical latent Pearson matrix;
- empirical shock Pearson matrix;
- empirical return Pearson matrix;
- empirical return Spearman matrix;
- absolute delta matrix;
- MAE;
- RMSE;
- Max Absolute Error;
- coppia con Max Absolute Error;
- lower-tail dependence 5%;
- upper-tail dependence 5%.

## 14. Statistics - intensità
Per ogni coppia, scenario e fascia d'intensità mostrare:
- sample size;
- empirical Pearson dei rendimenti;
- empirical Spearman dei rendimenti;
- delta dal target;
- absolute delta.

## 15. General Statistics
Mostrare:
- General empirical Pearson matrix;
- General empirical Spearman matrix;
- sample size complessivo.

La General è informativa e non sostituisce le matrici scenario-specifiche.

## 16. Sample size
Mostrare sempre il numero di osservazioni usate per ogni correlazione, soprattutto per scenari meno frequenti, fasce d'intensità estreme e analisi delle code.

Non introdurre inizialmente una soglia automatica di invalidazione per campioni piccoli.

## 17. Diagnostica della pipeline
Il confronto dei livelli deve rendere evidente dove nasce uno scostamento.

Esempio:

`Target 0.75 -> Operational 0.75 -> Latent 0.75 -> Empirical latent 0.75 -> Empirical shock 0.74 -> Empirical return 0.65`

indica che la struttura latente funziona e la distorsione nasce successivamente.

Se invece:

`Latent 0.75 -> Empirical latent 0.61`

il problema è nella generazione multivariata/copula.

## 18. Reject & Redraw
Le empirical return correlations principali devono essere calcolate sui **vettori accettati ed effettivamente utilizzati dalla simulazione**.

Le osservazioni rifiutate possono essere mantenute separatamente per diagnostica, ma non entrano nella metrica economica principale.

## 19. Integrità statistica
La Statistics non deve:
- rieseguire estrazioni per migliorare le correlazioni;
- eliminare osservazioni valide;
- modificare rendimenti o shock;
- modificare matrici;
- selezionare percorsi favorevoli.

Deve rappresentare fedelmente l'output del motore.

## 20. Output strutturato
Oltre alla UI, predisporre output macchina per:
- matrici empiriche;
- delta;
- MAE;
- RMSE;
- Max Absolute Error;
- sample size;
- tail dependence;
- breakdown per scenario;
- breakdown per intensità.

Le statistiche non devono esistere soltanto come elementi grafici frontend.

## 21. Stato del test
Non classificare inizialmente il risultato come PASS/WARNING/FAIL in base allo scostamento empirico.

Fornire valori quantitativi. Le soglie saranno eventualmente definite dopo l'osservazione dei primi test.

## 22. Decisioni definitive
- Capitolo 17 diagnostico, non correttivo.
- Correlazioni misurate a livello latent, shock e rendimenti finali.
- Rendimenti finali = metrica principale.
- Pearson primaria; Spearman diagnostica.
- Analisi separata per i 4 macro-scenari.
- General empirical correlation aggiuntiva e informativa.
- Banco prova 10.000 × 50 anni × 12 mesi.
- Nessuna simulazione dedicata differente.
- Analisi anche per fasce d'intensità 0-20, 20-40, 40-60, 60-80, 80-100%.
- Distinguere target, operational, latent ed empirical correlation.
- Per ora latent = operational.
- Delta e absolute delta per coppia.
- MAE, RMSE e Max Absolute Error per scenario.
- Mostrare la coppia col massimo errore.
- Lower-tail e upper-tail dependence al 5%.
- Nessun livello 1%.
- Mostrare sample size.
- Nessuna soglia KO iniziale.
- Nessun fail-fast per semplice scostamento statistico.
- Nessuna calibrazione automatica.
- Nessuna modifica delle matrici durante il controllo.
- L'eventuale calibrazione verrà valutata solo dopo i risultati.
- Correlazioni principali calcolate sui vettori accettati.
- Statistics progettata per localizzare il punto della pipeline in cui nasce una distorsione.
- Output strutturato disponibile anche per analisi macchina.
