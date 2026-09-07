# 13-costruzione-e-validazione-delle-matrici

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

## 1. Scopo

Definire costruzione e validazione delle matrici di correlazione prima dell'avvio del Monte Carlo. Il capitolo non corregge matrici non valide e non genera ancora shock correlati.

## 2. Fonte dati

Le correlazioni provengono dalla tabella `etf_correlations`, che contiene almeno:

- `id`
- `isin1`
- `isin2`
- `expansion`
- `recession`
- `stagflation`
- `soft_landing`

Ogni coppia di ETF deve comparire una sola volta. L'ordine `isin1`/`isin2` non rappresenta una direzione: `rho(A,B) = rho(B,A)`.

## 3. Universo della matrice

Considerare soltanto ETF con peso maggiore di zero.

Per struttura applicativa non sono previsti ETF duplicati nel portafoglio. Se un duplicato viene comunque rilevato, effettuare fail-fast.

Con N ETF attivi sono necessarie:

`N * (N - 1) / 2`

coppie distinte.

## 4. Correlazioni mancanti

Se manca anche una sola coppia necessaria, la simulazione NON parte.

Non usare mai `0` come fallback e non stimare automaticamente valori mancanti.

L'errore deve essere puntuale e indicare tutte le coppie/scenari mancanti, possibilmente raccogliendoli in un'unica risposta per consentire una correzione rapida del DB.

## 5. Duplicati

Se esistono più record per la stessa coppia, anche in ordine inverso (`A-B` e `B-A`), la simulazione NON parte.

Non mediare, non scegliere arbitrariamente un record e non ignorare il duplicato.

Segnalare almeno:

- ISIN coinvolti;
- ID dei record duplicati, se disponibili.

## 6. Self-correlation

Non devono esistere record DB con `isin1 = isin2`.

La diagonale viene generata dal servizio:

`rho(i,i) = 1`

Una self-correlation censita nel DB è un errore di configurazione.

## 7. Quattro matrici

All'avvio della simulazione costruire e validare quattro matrici N×N:

- Expansion
- Soft Landing
- Recession
- Stagflation

Le matrici vengono precalcolate una sola volta e non ricostruite ogni mese.

Il mese utilizza la matrice corrispondente allo scenario corrente.

Le correlazioni:

- non vengono mensilizzate;
- non vengono modificate dall'intensità.

## 8. Costruzione simmetrica

Per ogni record DB della coppia A-B:

`matrix[A][B] = rho`

`matrix[B][A] = rho`

La diagonale è sempre 1.

Dopo la costruzione eseguire comunque una validazione tecnica della simmetria.

## 9. Ordine degli ETF

L'ordine di righe e colonne deve essere deterministico e conservato insieme alla matrice.

Struttura runtime concettuale:

```text
ScenarioCorrelationMatrix {
    scenario
    assetIsins[]
    matrix[][]
}
```

`matrix[i][j]` deve sempre riferirsi a `assetIsins[i]` e `assetIsins[j]`.

Lo stesso ordine dovrà essere rispettato nei capitoli successivi durante la generazione degli shock.

## 10. Validazione dei coefficienti

Ogni correlazione deve rispettare:

`-1 <= rho <= 1`

Sono invalidi anche:

- `null`;
- `NaN`;
- `Infinity`.

Nessun clamp e nessuna correzione automatica.

In caso di errore indicare coppia, scenario e valore.

## 11. Validazione della diagonale

Deve valere:

`matrix[i][i] = 1`

Una violazione indica un errore tecnico e causa fail-fast.

## 12. Validazione della simmetria

Deve valere:

`matrix[i][j] = matrix[j][i]`

Una violazione indica un errore di costruzione/runtime e causa fail-fast.

## 13. Validazione PSD

Ogni matrice deve essere Positive Semi-Definite (PSD).

Calcolare gli autovalori e definire:

`lambdaMin = minimumEigenvalue(matrix)`

Utilizzare la tolleranza tecnica fissa a codice:

`PSD_EPSILON = 1e-6`

Regola:

`lambdaMin >= -1e-6 -> matrice considerata PSD`

`lambdaMin < -1e-6 -> matrice non PSD`

Non creare una property DB per la tolleranza.

## 14. Matrice non PSD

Il capitolo 13 deve:

- rilevare la non-PSD;
- diagnosticarla;
- segnalarla.

NON deve correggerla.

L'eventuale correzione appartiene al capitolo 14.

Una matrice che rimane non valida non può essere utilizzata dalla simulazione.

## 15. PSD vs Positive Definite

In questo capitolo non richiedere che la matrice sia strettamente Positive Definite.

Una matrice PSD è considerata matematicamente valida.

L'eventuale necessità di Positive Definiteness dipenderà dal metodo scelto successivamente per generare gli shock correlati.

## 16. Condition number

Calcolare, quando numericamente significativo, anche il condition number.

È inizialmente una metrica diagnostica.

Non introdurre soglie KO automatiche.

## 17. Ordine delle validazioni

Prima del loop Monte Carlo:

```text
1. determina ETF attivi
2. verifica eventuali ETF duplicati
3. calcola numero coppie attese
4. carica etf_correlations
5. rileva self-correlation
6. rileva coppie duplicate
7. rileva coppie mancanti
8. valida i quattro valori macro per ogni coppia
9. costruisci le quattro matrici
10. valida diagonale
11. valida simmetria
12. valida range [-1,+1]
13. calcola autovalori
14. verifica PSD con epsilon 1e-6
15. calcola diagnostica numerica
16. solo dopo le validazioni procedi con la simulazione
```

## 18. Errori

Gli errori devono essere espliciti e rapidamente risolvibili.

Esempi concettuali:

```text
MISSING_ETF_CORRELATION
isin1=...
isin2=...
scenario=...
```

```text
DUPLICATE_ETF_CORRELATION
isin1=...
isin2=...
recordIds=[...]
```

```text
INVALID_ETF_CORRELATION_VALUE
isin1=...
isin2=...
scenario=...
value=...
```

```text
CORRELATION_MATRIX_NOT_PSD
scenario=...
minimumEigenvalue=...
epsilon=0.000001
```

I nomi concreti possono essere adattati all'architettura del progetto.

## 19. Statistics

Per ciascuno dei quattro scenari mostrare nella pagina Statistics almeno:

- numero ETF;
- dimensione matrice;
- numero coppie attese;
- numero coppie trovate;
- numero coppie mancanti;
- elenco correlazioni mancanti;
- eventuali duplicati;
- correlazione minima;
- correlazione massima;
- diagonale OK/KO;
- simmetria OK/KO;
- range `[-1,+1]` OK/KO;
- minimum eigenvalue;
- PSD OK/KO;
- `PSD_EPSILON`;
- autovalori;
- condition number, quando disponibile.

Mostrare inoltre la matrice completa dello scenario, con nickname e ISIN quando disponibili. Se l'interfaccia lo consente, può essere aggiunta una heatmap diagnostica.

## 20. Nessuna correzione silenziosa

Il capitolo 13 NON deve:

- sostituire correlazioni mancanti con zero;
- stimare correlazioni;
- mediare duplicati;
- fare clamp;
- correggere matrici non PSD;
- modificare coefficienti per migliorare il condition number;
- modificare correlazioni in funzione dell'intensità.

## 21. Confini con i capitoli successivi

Il capitolo 14 definirà l'eventuale correzione delle matrici non valide.

Il capitolo 15 definirà la generazione degli shock correlati.

Il capitolo 16 definirà il modello di dipendenza/copula.

Il capitolo 17 controllerà le correlazioni empiriche realmente ottenute.

## 22. Decisioni definitive

- Tabella sorgente: `etf_correlations`.
- Una sola riga per coppia.
- Ordine `isin1`/`isin2` irrilevante.
- Quattro correlazioni scenario-specifiche.
- Correlazioni mancanti: fail-fast con dettaglio esplicito.
- Duplicati: fail-fast con dettaglio.
- Self-correlation DB non ammessa.
- Diagonale generata a codice e pari a 1.
- ETF a peso zero esclusi.
- ETF duplicati non previsti; se rilevati, errore.
- Quattro matrici precalcolate all'avvio.
- Matrici non ricostruite ogni mese.
- Correlazioni non mensilizzate.
- Intensità non modifica le correlazioni.
- Matrice e ordine ISIN conservati insieme.
- Coefficienti obbligatoriamente in `[-1,+1]`.
- Nessun clamp.
- Simmetria obbligatoria.
- Validazione PSD obbligatoria.
- `PSD_EPSILON = 1e-6`, fisso a codice.
- Il capitolo 13 rileva ma non corregge matrici non PSD.
- Positive Definiteness non richiesta in questo capitolo.
- Condition number solo diagnostico.
- Validazioni eseguite prima del loop Monte Carlo.
- Diagnostica completa nella pagina Statistics.
