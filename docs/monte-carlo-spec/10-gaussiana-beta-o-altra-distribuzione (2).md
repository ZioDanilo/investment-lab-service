# 10-gaussiana-beta-o-altra-distribuzione

> **Stato:** specifica consolidata v1.1 per implementazione.
>
> **Regola di lettura:** il capitolo specialistico è autoritativo per formule e regole del proprio ambito; il capitolo 27 è autoritativo per ordine di esecuzione e orchestrazione; `00-monte-carlo-engine-specification.md` definisce la gerarchia complessiva. Non introdurre fallback, soglie, property, formule o comportamenti non documentati.

# Investment Lab X - Monte Carlo Engine 2.0

Versione: 1.0

## Stato del capitolo

**RISOLTO NEL CAPITOLO 09**

Questo punto del programma prevedeva la valutazione tra Gaussiana, Beta o altra distribuzione per la generazione dei rendimenti.

La decisione è già stata presa e formalizzata integralmente nel capitolo `09-distribuzione-dei-rendimenti.md`.

## Decisione

Il Monte Carlo Engine utilizza:

- Student-t standardizzata;
- gradi di libertà `ν = 5`;
- `ν` fisso a codice;
- nessuna property DB aggiuntiva;
- stessa distribuzione per tutti gli ETF e macro-scenari;
- standardizzazione a media teorica 0 e deviazione standard teorica 1;
- Reject & Redraw rispetto al return range mensile effettivo;
- nessun clamp;
- massimo 1000 tentativi di redraw.

Gaussiana, Beta, skewed Student-t e mixture distributions non vengono utilizzate nella prima versione del nuovo motore.

## Regola di implementazione

Questo capitolo non introduce alcuna nuova logica e non deve duplicare nel codice quanto già specificato nel capitolo 09.

Per formule, validazioni, diagnostica, gestione delle code, Reject & Redraw e implementazione della Student-t fare esclusivo riferimento a `09-distribuzione-dei-rendimenti.md`.

## Conclusione

Il punto 10 è considerato definitivamente chiuso e assorbito dalle decisioni del capitolo 09.
