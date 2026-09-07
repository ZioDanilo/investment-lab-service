# 18-rendimento-ponderato

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

## 1. Scopo
Definire come i rendimenti mensili dei singoli ETF diventano il rendimento del portafoglio, come evolvono i controvalori e come avviene il drift naturale dei pesi. Il ribilanciamento resta al capitolo 19.

## 2. Capitale iniziale
Il capitale iniziale proviene dal frontend e viene utilizzato direttamente:

`portfolioValue_0 = initialCapital`

Non usare NAV 100. `initialCapital` deve essere finito e > 0, altrimenti fail-fast.

## 3. Pesi iniziali
I pesi frontend vengono convertiti in decimali. Deve valere:

`abs(sum(initialWeights) - 1) <= WEIGHT_EPSILON`

con:

`WEIGHT_EPSILON = 1e-6`

fisso a codice.

Non normalizzare automaticamente pesi errati.

## 4. Inizializzazione posizioni
Per ogni ETF:

`positionValue_i,0 = initialCapital * initialWeight_i`

Dopo l'inizializzazione i controvalori delle singole posizioni diventano la fonte di verità per i pesi correnti.

## 5. Long-only e nessun cash implicito
La versione corrente supporta esclusivamente:

`0 <= weight_i <= 1`

Niente short e niente leva tramite pesi >100%.

La somma degli ETF deve essere 100%. Un totale del 90% non implica automaticamente 10% cash: è una configurazione non valida.

## 6. Rendimento mensile ponderato
Il rendimento del mese usa i pesi all'inizio del mese:

`w_i,t = positionValue_i,t / portfolioValue_t`

`R_p,t = sum(w_i,t * R_i,t)`

Per ogni ETF calcolare anche:

`contribution_i,t = w_i,t * R_i,t`

Deve valere:

`R_p,t = sum(contribution_i,t)`

## 7. Evoluzione delle posizioni
Dopo il rendimento mensile:

`positionValue_i,t+1 = positionValue_i,t * (1 + R_i,t)`

Il portafoglio vale:

`portfolioValue_t+1 = sum(positionValue_i,t+1)`

## 8. Weight drift naturale
In assenza di ribilanciamento i pesi cambiano naturalmente:

`w_i,t+1 = positionValue_i,t+1 / portfolioValue_t+1`

Non continuare a utilizzare i pesi target originari: farlo equivarrebbe a introdurre implicitamente un ribilanciamento mensile.

Mantenere distinti:

- `targetWeight_i`
- `currentWeight_i`

Il target non viene sovrascritto dal peso driftato.

## 9. Nessun ribilanciamento implicito
Il capitolo 18 non riporta i pesi ai target:

- ogni mese;
- ogni anno;
- al cambio scenario;
- al cambio intensità.

Qualunque ribilanciamento esplicito appartiene al capitolo 19.

## 10. Limite inferiore dei rendimenti
Per ogni ETF deve valere:

`R_i,t >= -1`

Un rendimento inferiore a -100% causa fail-fast.

`R_i,t = -1` è ammesso e azzera la posizione.

Una posizione a zero resta a zero in assenza di un futuro ribilanciamento:

`0 * (1 + R) = 0`

## 11. Controllo tramite variazione del capitale
Calcolare anche:

`R_p,t_NAV = portfolioValue_t+1 / portfolioValue_t - 1`

Deve coincidere con:

`R_p,t_weighted = sum(w_i,t * R_i,t)`

entro tolleranza floating point.

Calcolare:

`portfolioReturnDifference = abs(R_p,t_weighted - R_p,t_NAV)`

Una divergenza significativa indica un bug e non deve essere corretta silenziosamente.

## 12. Invarianti
Deve valere, entro tolleranza:

`portfolioValue_t = sum(positionValue_i,t)`

E, finché il portafoglio ha valore positivo:

`sum(currentWeights) = 1`

## 13. Nessun cash flow esterno
Non introdurre in questo capitolo:

- versamenti;
- prelievi;
- tasse;
- commissioni;
- costi di transazione;
- cash flow esterni.

Il capitale cambia esclusivamente tramite i rendimenti degli asset.

## 14. Statistics per ETF
Per un percorso/campione diagnostico selezionato mostrare almeno:

- percorso;
- anno;
- mese;
- scenario;
- intensità;
- ETF/ISIN;
- peso iniziale mese;
- rendimento ETF;
- contributo ponderato;
- controvalore iniziale;
- controvalore finale;
- peso finale mese.

## 15. Statistics del portafoglio
Mostrare almeno:

- capitale iniziale mese;
- somma contributi ETF;
- rendimento ponderato;
- rendimento derivato dal capitale;
- differenza weighted-vs-capital;
- capitale finale mese;
- somma controvalori finali;
- somma pesi iniziali;
- somma pesi finali.

## 16. Output frontend
Poiché viene utilizzato il capitale reale, il servizio può restituire direttamente:

- capitale iniziale;
- capitale corrente/finale;
- controvalori delle posizioni;
- rendimenti percentuali;
- contributi percentuali;
- pesi correnti.

Non è necessaria una seconda rappresentazione NAV=100.

## 17. Confine col capitolo 19
Il capitolo 19 definirà l'eventuale ribilanciamento. Non decidere qui:

- frequenza;
- ribilanciamento mensile/annuale;
- threshold rebalancing;
- ritorno ai target;
- costi;
- turnover.

## 18. Decisioni definitive
- Capitale iniziale ricevuto dal frontend e utilizzato direttamente.
- Nessun NAV 100 interno.
- `initialCapital > 0`.
- Posizioni iniziali = capitale × peso iniziale.
- Pesi convertiti in decimali.
- Portafoglio long-only.
- Nessun peso negativo o leva tramite peso >100%.
- Nessuna liquidità implicita.
- Somma pesi = 1 entro `WEIGHT_EPSILON = 1e-6`.
- Nessuna normalizzazione automatica.
- Rendimento mensile calcolato coi pesi a inizio mese.
- `portfolioReturn = sum(weight_i * return_i)`.
- Contributo per ETF calcolato esplicitamente.
- Controvalori aggiornati individualmente ogni mese.
- Controvalori = fonte di verità dopo l'inizializzazione.
- Current weights derivati dai controvalori.
- Weight drift naturale.
- Target weights distinti dai current weights.
- Nessun ribilanciamento implicito.
- Rendimenti sotto -100% vietati; -100% ammesso.
- Posizione azzerata resta a zero senza ribilanciamento.
- Controllo indipendente tramite variazione del capitale.
- Weighted return e capital-derived return devono coincidere entro tolleranza.
- Verifica `portfolioValue = sum(positionValues)`.
- Nessun cash flow esterno nel capitolo 18.
- Diagnostica Statistics per ETF e portafoglio.
- Output monetari reali disponibili direttamente al frontend.
- Ribilanciamento rinviato al capitolo 19.
