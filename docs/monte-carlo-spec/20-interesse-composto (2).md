# 20-interesse-composto

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0
Versione: 1.0

## 1. Scopo

Formalizzare la capitalizzazione composta del portafoglio nella simulazione Monte Carlo.

L'interesse composto non costituisce un meccanismo aggiuntivo rispetto alla dinamica già definita nei capitoli 18-19: deriva naturalmente dall'applicazione mensile dei rendimenti ai controvalori risultanti dal mese precedente.

Il capitolo definisce inoltre:
- composizione mensile;
- rendimento annuale;
- rendimento totale del percorso;
- comportamento in caso di capitale pari a zero;
- precisione numerica;
- controlli tecnici di consistenza.

## 2. Capitalizzazione mensile

Ogni mese il rendimento del portafoglio viene applicato al capitale risultante dal mese precedente:

`portfolioValue_t+1 = portfolioValue_t * (1 + portfolioReturn_t)`

Non utilizzare somme o medie dei rendimenti mensili per aggiornare il capitale.

È vietata una logica del tipo:

`initialCapital * (1 + sum(monthlyReturns))`

La simulazione deve essere composta mese per mese.

## 3. Coerenza con i controvalori ETF

Resta valida la logica del capitolo 18:

`positionValue_i,t+1 = positionValue_i,t * (1 + ETFReturn_i,t)`

e:

`portfolioValue_t+1 = sum(positionValue_i,t+1)`

Il capitale aggregato e la somma dei controvalori devono coincidere entro tolleranza numerica.

## 4. Rendimento annuale del portafoglio

Il rendimento annuale è la composizione geometrica dei rendimenti mensili dell'anno:

`annualPortfolioReturn = product(1 + monthlyPortfolioReturn_m) - 1`

per i 12 mesi dell'anno.

Deve inoltre valere:

`annualPortfolioReturn = endOfYearCapital / startOfYearCapital - 1`

entro tolleranza numerica.

Le due formule rappresentano lo stesso risultato e devono essere utilizzate come controllo di consistenza.

## 5. Nessuna somma o media annuale

Non calcolare il rendimento annuale come:

`sum(monthlyReturns)`

né come:

`average(monthlyReturns) * 12`

Il rendimento annuale deve essere sempre composto.

## 6. Rendimento totale del percorso

Alla fine della simulazione:

`totalReturn = finalCapital / initialCapital - 1`

Il total return rappresenta il rendimento cumulato dell'intero percorso.

Non deve essere confuso con il CAGR, che verrà definito nel capitolo dedicato.

Equivalentemente:

`totalReturn = product(1 + monthlyPortfolioReturn_t) - 1`

sull'intero orizzonte.

Le due modalità devono coincidere entro tolleranza numerica.

## 7. Nessuna traiettoria patrimoniale standalone degli ETF

Non costruire una seconda traiettoria patrimoniale completa per ciascun ETF come se fosse detenuto autonomamente per tutto l'orizzonte.

Non è necessaria ai fini del motore.

Quando serve il rendimento annuale di un ETF, ad esempio per il grafico definito nel capitolo 19, comporre esclusivamente i suoi rendimenti mensili dell'anno:

`annualETFReturn = product(1 + ETFMonthlyReturn_m) - 1`

Non mantenere un capitale virtuale standalone pluriennale per ciascun ETF.

## 8. Ribilanciamento e interesse composto

Il ribilanciamento annuale definito nel capitolo 19 non interrompe e non resetta la capitalizzazione.

Esempio:

```text
initialCapital = 100000
fine anno 1 = 108000
rebalance = redistribuzione dei 108000
inizio anno 2 = 108000
```

Il rebalance modifica soltanto la distribuzione del capitale tra le posizioni.

Non modifica il valore complessivo del portafoglio.

## 9. Portafoglio a zero

Se durante un percorso:

`portfolioValue = 0`

il percorso **non deve essere terminato anticipatamente**.

Da quel momento il capitale rimane:

`portfolioValue = 0`

fino alla fine dell'orizzonte simulato.

Analogamente, tutte le posizioni rimangono a zero.

## 10. Motivazione del mantenimento del percorso a zero

Un percorso arrivato a zero è un risultato economico valido della simulazione e deve continuare a contribuire alle statistiche finali.

Deve quindi essere presente:
- anno per anno;
- nei risultati finali;
- nelle medie;
- nelle mediane;
- nei percentili;
- negli altri KPI applicabili.

Non eliminare il percorso dal campione.

Non sostituirlo con un nuovo percorso.

Non considerarlo un errore runtime.

## 11. Comportamento dopo lo zero

Una volta raggiunto:

`portfolioValue = 0`

non è necessario continuare a eseguire calcoli economici complessi sul percorso.

Il motore può applicare una scorciatoia computazionale:

```text
portfolioValue = 0
positionValues = 0
portfolioReturns successivi = 0
```

fino alla conclusione temporale del percorso.

La traiettoria deve però continuare ad avere tutti i periodi previsti, così da mantenere coerenti statistiche e output.

Il percorso non deve essere rimosso.

## 12. Ribilanciamento con capitale zero

Se il capitale complessivo è zero, un successivo evento teorico di ribilanciamento non può ricostituire le posizioni:

`0 * targetWeight_i = 0`

Pertanto:

`positionValue_i = 0`

per tutti gli ETF.

Il portafoglio resta definitivamente a zero.

## 13. Precisione numerica

Non arrotondare durante la simulazione:
- capitale;
- controvalori;
- rendimenti;
- contributi;
- risultati intermedi.

Utilizzare la precisione numerica nativa prevista dall'implementazione, tipicamente `double`.

L'arrotondamento deve avvenire esclusivamente in fase di presentazione/output quando necessario.

## 14. Nessun arrotondamento monetario mensile

Non arrotondare i controvalori a centesimi dopo ogni mese.

Un arrotondamento ricorrente introdurrebbe errori artificiali che possono accumularsi su simulazioni di molti anni.

I valori monetari possono essere formattati a due decimali soltanto nel frontend.

## 15. Valori non finiti

Durante la capitalizzazione verificare che i valori numerici restino finiti.

Sono condizioni di errore:
- `NaN`;
- `+Infinity`;
- `-Infinity`;
- capitale negativo.

In questi casi:

**fail-fast.**

Questi casi rappresentano errori numerici o violazioni delle assunzioni del modello, non risultati economici validi.

## 16. Nessun limite massimo artificiale

Non introdurre un tetto massimo al capitale.

Un percorso con crescita molto elevata resta valido finché:
- il valore è finito;
- i calcoli numerici restano validi;
- non vengono violate altre regole strutturali.

Non clampare artificialmente il capitale.

## 17. Capitale negativo

Con portafoglio long-only e rendimenti degli ETF non inferiori a -100%, il capitale non dovrebbe diventare negativo.

Se:

`portfolioValue < 0`

effettuare fail-fast.

Non correggere il valore portandolo automaticamente a zero.

## 18. Controllo annuale

Per ogni anno verificare:

`annualReturnFromMonthlyCompounding`

contro:

`annualReturnFromCapital = endCapital / startCapital - 1`

Calcolare:

`annualReturnDifference = abs(annualReturnFromMonthlyCompounding - annualReturnFromCapital)`

La differenza deve restare entro tolleranza numerica.

## 19. Controllo sull'intero percorso

Alla fine verificare:

`totalReturnFromMonthlyCompounding`

contro:

`totalReturnFromCapital = finalCapital / initialCapital - 1`

Calcolare:

`totalReturnDifference = abs(totalReturnFromMonthlyCompounding - totalReturnFromCapital)`

Una differenza significativa indica un errore nella pipeline.

## 20. Statistics minime

Il capitolo 20 non introduce nuovi KPI economici nella pagina Statistics.

Mantenere esclusivamente i controlli tecnici necessari a individuare bug:
- differenza tra annual return composto e annual return derivato dal capitale;
- differenza tra total return composto e total return derivato dal capitale.

Non aggiungere ulteriori statistiche dedicate all'interesse composto.

Capitale, drawdown, CAGR e percentili vengono trattati nei capitoli successivi.

## 21. Percorsi a zero nelle statistiche

I percorsi che raggiungono capitale zero devono rimanere nel dataset statistico.

Non filtrarli come outlier o errori tecnici per il solo fatto di essere arrivati a zero.

Il loro trattamento nei singoli KPI deve rispettare la definizione specifica del KPI nei capitoli successivi.

## 22. Ordine mensile

La sequenza economica resta:

```text
1. capitale/posizioni iniziali del mese
2. determinazione dei current weights
3. generazione dei rendimenti ETF
4. calcolo del rendimento del portafoglio
5. applicazione dei rendimenti alle posizioni
6. aggiornamento del capitale
7. controlli di consistenza
8. eventuale chiusura dell'anno
9. eventuale ribilanciamento secondo capitolo 19
10. mese successivo
```

## 23. Decisioni definitive

- Capitalizzazione mensile.
- `capital_t+1 = capital_t * (1 + portfolioReturn_t)`.
- Nessuna somma o media dei rendimenti per aggiornare il capitale.
- Rendimento annuale composto geometricamente sui 12 mesi.
- Controllo del rendimento annuale tramite variazione del capitale.
- Total return = `finalCapital / initialCapital - 1`.
- Total return distinto dal CAGR.
- Nessuna traiettoria patrimoniale standalone pluriennale per i singoli ETF.
- Per il grafico annuale ETF comporre soltanto i rendimenti mensili dell'anno.
- Il ribilanciamento non resetta il capitale.
- Il rebalance redistribuisce il capitale esistente.
- Se il capitale arriva a zero, il percorso non termina.
- Un percorso a zero resta a zero fino alla fine.
- Il percorso a zero mantiene tutti i periodi temporali previsti.
- I percorsi a zero restano nel campione statistico.
- Possibile scorciatoia computazionale dopo lo zero mantenendo output temporale coerente.
- Un rebalance con capitale zero non ricostituisce il portafoglio.
- Nessun arrotondamento durante i calcoli.
- Nessun arrotondamento mensile ai centesimi.
- Formattazione monetaria soltanto in output/frontend.
- NaN/Infinity causano fail-fast.
- Capitale negativo causa fail-fast.
- Nessun limite massimo artificiale al capitale.
- Statistics dedicate ridotte ai controlli tecnici di consistenza.
