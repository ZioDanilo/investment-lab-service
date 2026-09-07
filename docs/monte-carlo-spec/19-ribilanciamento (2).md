# 19-ribilanciamento

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0
Versione: 1.0

## 1. Scopo
Definire il ribilanciamento del portafoglio: **annuale, completo e ai target weight originali**. La simulazione parte convenzionalmente da gennaio.

## 2. Frequenza e momento
Il portafoglio evolve liberamente per 12 mesi. Dopo il rendimento di dicembre e la chiusura dell'anno, se la simulazione continua, viene ribilanciato prima del gennaio successivo.

Operativamente: dopo i mesi `12, 24, 36, ...`.

Non ribilanciare dopo l'ultimo mese della simulazione.

## 3. Target e current weights
I `targetWeight` scelti dall'utente restano immutabili per tutto il percorso.

I `currentWeight` derivano dai controvalori correnti e driftano liberamente durante l'anno:

`currentWeight_i = positionValue_i / portfolioValue`

Mantenere sempre distinti target e current weights.

## 4. Ribilanciamento completo
Al rebalance:

`positionValueAfter_i = portfolioValueBeforeRebalance * targetWeight_i`

Dopo l'operazione ogni ETF torna esattamente al proprio target entro tolleranza.

Non utilizzare ribilanciamento parziale, bande o soglie.

## 5. Conservazione del capitale
Il rebalance non genera né distrugge capitale:

`portfolioValueBeforeRebalance = portfolioValueAfterRebalance`

e:

`sum(positionValueAfter_i) = portfolioValueAfterRebalance`

entro tolleranza numerica.

Una discrepanza significativa causa fail-fast.

## 6. Costi e fiscalità
Il ribilanciamento è a costo zero.

Non introdurre:
- commissioni;
- spread;
- slippage;
- costi di transazione;
- capital gain tax;
- altre logiche fiscali.

## 7. Posizioni a zero
Una posizione arrivata a zero resta tale fino al successivo rebalance.

Al ribilanciamento viene ricostituita integralmente secondo il target:

`positionValueAfter_i = portfolioValue * targetWeight_i`

## 8. Scenario e intensità
Non ribilanciare:
- al cambio di macro-scenario;
- al cambio di intensità.

Scenario e intensità descrivono il mercato e non sono segnali di asset allocation.

## 9. Regola deterministica
La regola temporale è identica per tutti i percorsi:

`ogni 12 mesi, se esiste un periodo successivo`

Gli importi riallocati differiscono tra percorsi in funzione dei rendimenti simulati.

## 10. Turnover
A ogni rebalance:

`portfolioTurnover = 0.5 * sum(abs(targetWeight_i - weightBeforeRebalance_i))`

Il turnover è esclusivamente diagnostico e non modifica il rendimento.

Per ETF:

`ETFWeightReallocation_i = abs(targetWeight_i - weightBeforeRebalance_i)`

## 11. Statistics semplificate
Mostrare soltanto:
- **turnover medio annuale**;
- **turnover mediano**;
- **turnover per ETF**.

Non aggiungere nella prima versione P95, massimo turnover o altri KPI di ribilanciamento.

## 12. Grafico annuale già previsto
Per il grafico diagnostico annuale utilizzare:

`chartContribution_i,year = annualETFReturn_i,year * targetWeight_i`

Non ricostruire i pesi effettivi mese per mese e non usare peso medio annuale.

Il dato deve essere interpretato come:

**contributo ETF a peso target**

e non come contributo contabile effettivo esatto al rendimento del portafoglio.

Questa semplificazione riguarda esclusivamente il grafico. Il calcolo reale mensile del portafoglio continua a utilizzare i `currentWeight` effettivi, come stabilito nel capitolo 18.

## 13. Rendimento annuale ETF per il grafico
Comporre i rendimenti mensili del singolo ETF:

`annualETFReturn = product(1 + monthlyReturn_m) - 1`

Poi:

`chartContribution = annualETFReturn * targetWeight`

## 14. Ordine delle operazioni a fine anno
Nei mesi 12, 24, 36, ...:

```text
1. determinare scenario e intensità
2. generare i rendimenti ETF
3. applicare i rendimenti alle posizioni
4. calcolare il rendimento mensile del portafoglio
5. aggiornare capitale e current weights
6. chiudere i dati annuali
7. calcolare annualETFReturn per il grafico
8. se esiste un mese successivo, eseguire il rebalance
9. iniziare l'anno successivo dai target weights
```

Il rebalance non deve modificare i rendimenti dell'anno appena concluso.

## 15. Controlli
Dopo ogni ribilanciamento verificare:

`abs(portfolioValueBefore - portfolioValueAfter) <= numericalTolerance`

`abs(sum(positionValuesAfter) - portfolioValueAfter) <= numericalTolerance`

Per ogni ETF:

`abs(currentWeightAfter_i - targetWeight_i) <= WEIGHT_EPSILON`

In caso di violazione: fail-fast.

## 16. Fuori scope
Il capitolo non introduce:
- ribilanciamento a soglia;
- ribilanciamento tattico;
- market timing;
- target dinamici;
- costi;
- fiscalità;
- frequenza configurabile;
- nuove property DB.

## 17. Decisioni definitive
- Partenza convenzionale a gennaio.
- Ribilanciamento annuale.
- Rebalance dopo 12 mesi completi e prima dell'anno successivo.
- Nessun rebalance dopo l'ultimo mese simulato.
- Ritorno completo ai target.
- Target weights immutabili.
- Drift naturale dei current weights durante l'anno.
- Capitale totale invariato dal rebalance.
- Nessun costo e nessuna fiscalità.
- Posizioni a zero ricostituite al rebalance.
- Nessun rebalance per cambio scenario o intensità.
- Regola identica per tutti i percorsi.
- Turnover diagnostico.
- Statistics: turnover medio annuale, mediano e per ETF.
- Grafico: `annualETFReturn * targetWeight`.
- Denominazione: **contributo ETF a peso target**.
- Nessuna ricostruzione mensile dei pesi per il grafico.
- Calcolo reale del portafoglio invariato e basato sui current weights.
