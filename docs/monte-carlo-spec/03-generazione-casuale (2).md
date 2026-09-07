# 03 - generazione-casuale

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.1

------------------------------------------------------------------------

# Scopo

Definire la filosofia e i requisiti del generatore casuale utilizzato
dal motore Monte Carlo.

Le distribuzioni specifiche e le regole economiche sono definite nei
capitoli successivi.

------------------------------------------------------------------------

# Obiettivo

Il motore deve produrre simulazioni statisticamente corrette e
indipendenti.

La ripetibilità di una simulazione non è un obiettivo del progetto.

------------------------------------------------------------------------

# Decisioni approvate

-   Non viene utilizzato alcun seed configurabile dall'utente.
-   L'utente non può impostare un seed.
-   Il seed non viene salvato nel database.
-   Il seed non viene mostrato nell'interfaccia.
-   Non è richiesto poter riprodurre identicamente una simulazione
    precedente.
-   Due esecuzioni consecutive possono produrre percorsi differenti.
-   Le differenze tra simulazioni sono una caratteristica prevista del
    motore.

------------------------------------------------------------------------

# Generatore pseudocasuale di base

Il servizio deve utilizzare un generatore pseudocasuale affidabile
fornito dalla piattaforma/runtime o una soluzione equivalente
appropriata.

Il generatore di base deve poter produrre variabili uniformi di buona
qualità nell'intervallo `[0,1)`.

Le estrazioni uniformi costituiscono la sorgente casuale di base per:

-   scenario iniziale;
-   decisioni di permanenza;
-   transizioni della matrice;
-   trasformazioni verso distribuzioni non uniformi;
-   shock dei rendimenti;
-   eventuali Reject & Redraw.

------------------------------------------------------------------------

# Distribuzioni non uniformi

Il fatto che il generatore di base produca uniformi NON implica che
tutte le variabili del modello siano uniformi.

In particolare, è già approvato che l'intensità macro utilizzi una:

**Gaussiana troncata specifica per scenario**

ottenuta mediante opportuna trasformazione/algoritmo a partire dalla
sorgente pseudocasuale.

La stessa sorgente casuale potrà essere trasformata nei capitoli
successivi per generare altre distribuzioni necessarie al modello.

------------------------------------------------------------------------

# Indipendenza e dipendenza

Le estrazioni casuali elementari devono evitare bias e dipendenze
accidentali.

Le dipendenze economiche devono invece essere introdotte esplicitamente
dal modello, ad esempio tramite:

-   catena degli scenari;
-   memoria dell'intensità;
-   mean reversion;
-   matrici di correlazione;
-   trasformazioni multivariate.

Non bisogna confondere dipendenza modellata con scarsa qualità del
generatore casuale.

------------------------------------------------------------------------

# Reject & Redraw

Il motore può utilizzare Reject & Redraw quando previsto esplicitamente
da un capitolo dell'algoritmo.

Non deve però essere usato come correzione nascosta per compensare una
distribuzione progettata male.

Per l'intensità dei primi mesi di un nuovo scenario, le soglie 0.40 e
0.70 sono state definite come soglie statistiche morbide: la
distribuzione deve essere calibrata per concentrarsi naturalmente nelle
aree desiderate.

Reject & Redraw è quindi una soluzione residuale, non la regola
primaria.

------------------------------------------------------------------------

# Prestazioni

Il generatore deve essere adeguato a un numero elevato di:

-   simulazioni;
-   mesi;
-   ETF;
-   estrazioni correlate.

Le ottimizzazioni non devono alterare la distribuzione statistica
prevista.

------------------------------------------------------------------------

# Ambito del capitolo

Questo documento non definisce nel dettaglio:

-   probabilità dello scenario iniziale;
-   matrice di transizione;
-   inerzia ENTRY/PERSISTENCE/EXIT;
-   formula della Gaussiana troncata;
-   formula di mean reversion dell'intensità;
-   distribuzione dei rendimenti ETF;
-   correlazioni tra ETF;
-   copula o decomposizione della matrice.

Tali argomenti sono definiti nei rispettivi capitoli.

------------------------------------------------------------------------

# Decisione finale

Investment Lab X privilegia:

-   correttezza statistica;
-   casualità delle estrazioni;
-   trasparenza delle regole;

e non richiede la riproduzione identica di una simulazione precedente.

Nessuna parte dell'interfaccia deve essere aggiunta per gestire seed o
ripetibilità.
