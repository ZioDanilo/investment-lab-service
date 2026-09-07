# 23 - CAGR

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

Versione: 1.0

## 1. Scopo

Definire il calcolo del CAGR del singolo percorso Monte Carlo e il KPI
CAGR aggregato del portafoglio.

Il CAGR viene calcolato sull'intero orizzonte temporale scelto
dall'utente. Non vengono calcolati CAGR intermedi o parziali.

## 2. CAGR del singolo percorso

Per ogni percorso:

`CAGR = (finalCapital / initialCapital)^(1 / years) - 1`

dove:

-   `initialCapital` è il capitale iniziale reale della simulazione;
-   `finalCapital` è il capitale dell'ultimo mese del percorso;
-   `years` è l'intero orizzonte temporale scelto dall'utente.

Il CAGR deve essere ricavato dal rapporto tra capitale finale e capitale
iniziale.

Non deve essere ottenuto tramite:

-   media dei rendimenti mensili;
-   media dei rendimenti annuali;
-   somma dei rendimenti;
-   annualizzazione di una media aritmetica.

## 3. Orizzonte completo

Ogni percorso produce un solo CAGR riferito all'intera simulazione.

Esempio:

``` text
orizzonte utente = 50 anni
-> CAGR del percorso = CAGR sui 50 anni completi
```

Non calcolare automaticamente:

-   CAGR a 5 anni;
-   CAGR a 10 anni;
-   CAGR a 20 anni;
-   altri CAGR intermedi.

## 4. Percorso con capitale finale zero

Se:

`finalCapital = 0`

allora:

`CAGR = -1`

cioè:

`CAGR = -100%`

Questo risultato è valido indipendentemente dalla durata del percorso.

Il percorso non deve essere eliminato o considerato un errore.

## 5. Percorsi a zero nel campione

I percorsi con CAGR pari a -100% partecipano normalmente all'ordinamento
utilizzato per il KPI aggregato.

Non applicare trattamenti speciali.

Se un percorso a -100% rientra nel 5% inferiore eliminato dalla trimmed
mean, viene escluso esclusivamente dal calcolo del KPI CAGR aggregato.

Se i percorsi a -100% sono più numerosi del 5% del campione, quelli che
rimangono nel 90% centrale devono contribuire normalmente alla media.

Non rimuovere preventivamente i percorsi falliti.

## 6. KPI CAGR aggregato

Per ottenere il KPI CAGR del portafoglio:

1.  calcolare il CAGR di ogni percorso;
2.  ordinare tutti i CAGR in senso crescente;
3.  eliminare il 5% dei valori più bassi;
4.  eliminare il 5% dei valori più alti;
5.  calcolare la media aritmetica del 90% centrale.

Il KPI è quindi una:

**trimmed mean con trimming del 5% per ciascuna coda.**

Questa metodologia è coerente con quella scelta per il KPI Max Drawdown.

L'esclusione delle code riguarda soltanto il calcolo del KPI aggregato.
Tutti i percorsi restano disponibili per gli altri KPI, Statistics,
percentili e diagnostiche.

## 7. Denominazione del KPI

Il KPI deve essere denominato:

**CAGR Robusto**

Non chiamarlo `CAGR Mediano Robusto`, perché il valore principale non è
una mediana.

## 8. CAGR mediano tecnico

Calcolare e mantenere anche:

`medianCAGR`

utilizzando il CAGR di tutti i percorsi.

Il `medianCAGR`:

-   non sostituisce il CAGR Robusto;
-   non è uno dei sei KPI principali;
-   è un dato tecnico necessario alla selezione del percorso
    rappresentativo;
-   può essere utilizzato nelle diagnostiche.

## 9. Percorso rappresentativo

Resta valida la regola definita nel capitolo 22:

1.  individuare il 5% dei percorsi con Max Drawdown maggiore;
2.  all'interno di questo sottoinsieme scegliere il percorso il cui CAGR
    è più vicino al `medianCAGR`.

Di conseguenza devono essere disponibili almeno:

-   `cagr` per ogni percorso;
-   `medianCAGR`;
-   `maxDrawdown` per ogni percorso.

## 10. Percentili

Il capitolo 23 non definisce i percentili del CAGR.

I percentili della distribuzione dei risultati vengono trattati nel
capitolo successivo.

Non introdurre qui P5, P25, P75, P95 o altre statistiche percentile come
KPI aggiuntivi.

## 11. Precisione

Utilizzare:

-   `initialCapital` non arrotondato;
-   `finalCapital` non arrotondato;
-   precisione numerica nativa del backend.

Non arrotondare il CAGR durante il calcolo.

La formattazione percentuale avviene soltanto in output/frontend.

## 12. Validazioni

Prima del calcolo verificare:

`initialCapital > 0`

`finalCapital >= 0`

`years > 0`

Sono errori strutturali:

-   `initialCapital <= 0`;
-   `finalCapital < 0`;
-   `years <= 0`;
-   `NaN`;
-   `+Infinity`;
-   `-Infinity`.

Questi casi causano fail-fast.

`finalCapital = 0` è invece valido e produce CAGR = -100%.

## 13. Nessun CAGR inferiore a -100%

Con capitale finale non negativo:

`CAGR >= -1`

Un CAGR inferiore a -100% indica un errore numerico o strutturale e deve
causare fail-fast.

## 14. Coerenza con Total Return

Il CAGR deve essere coerente con il Total Return definito nel capitolo
20:

`totalReturn = finalCapital / initialCapital - 1`

e:

`1 + CAGR = (1 + totalReturn)^(1 / years)`

quando `finalCapital > 0`.

Questa relazione può essere utilizzata come controllo tecnico di
consistenza.

## 15. Statistics

Il capitolo non introduce nuove Statistics oltre ai dati necessari al
controllo e ai capitoli successivi.

Devono essere disponibili:

-   CAGR del singolo percorso;
-   CAGR Robusto aggregato;
-   `medianCAGR` tecnico.

I percentili vengono rinviati al capitolo 24.

## 16. Aggiornamento del contratto funzionale

Il capitolo 01 deve utilizzare la denominazione:

**CAGR Robusto**

al posto di:

**CAGR Robusto**

La definizione corretta del KPI 1 è la trimmed mean 5%-5% descritta in
questo capitolo.

## 17. Decisioni definitive

-   Un CAGR per ogni percorso.
-   CAGR calcolato sull'intero orizzonte della simulazione.
-   Formula basata su capitale iniziale e finale.
-   Nessun CAGR parziale.
-   Capitale finale zero = CAGR -100%.
-   Percorsi a zero mantenuti normalmente nel campione.
-   Nessun trattamento speciale dei CAGR -100%.
-   KPI CAGR aggregato = trimmed mean 5%-5%.
-   Il trimming è simmetrico: 5% inferiore e 5% superiore.
-   Media aritmetica del 90% centrale.
-   KPI denominato `CAGR Robusto`.
-   `medianCAGR` mantenuto come dato tecnico, non come KPI principale.
-   `medianCAGR` utilizzato per la selezione del percorso
    rappresentativo.
-   Percentili rinviati al capitolo 24.
-   Calcoli effettuati senza arrotondamenti.
-   Valori numerici invalidi causano fail-fast.
-   Coerenza verificabile con il Total Return.
