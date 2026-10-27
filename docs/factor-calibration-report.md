# Factor calibration report — V6 (audit, non approvazione)
Data: 2026-10-21 · Branch: `montecarlo` · Stato: **REVIEW_REQUIRED**

## Ambito e materiali verificati
Verifica statica del codice GitHub e confronto con diagnostiche del 21/10/2026 fornite dall'utente (run da 26 ETF, 1.000 percorsi × 360 mesi, manifest SHA-256 verificato). Non è stata eseguita una query live al database né un backtest empirico indipendente. Non sono stati cambiati i parametri V6.

Codice controllato:
- `src/data/factor-catalog-v1.js`: codici e famiglie, **non** stime dei premi;
- `src/models/FactorScenarioStatistic.js`: expectedReturn, volatility, provenance, methodology, observedAt;
- `src/models/EtfFactorExposure.js`: beta, historicalBeta, structuralBeta, provenance;
- `src/services/factorMarketUniverseSnapshotService.js`: validazione completezza delle cinque statistiche per fattore e returnMode;
- `src/services/monteCarloV5FoundationService.js`: manifest di generazione e verifica integrità;
- `src/services/marketUniverseV2Service.js`: snapshot utilizzato nella generazione;
- `src/services/monteCarloV6ReturnCalibrationService.js`: sensitivity read-only (non ricalcolo Monte Carlo).

Il catalogo versionato contiene 40 codici (contare nel file per il numero esatto); i 45 fattori citati nell'audit precedente appartengono allo stato del database/snapshot e non vanno sostituiti col catalogo statico.

## Risultati dei premi (scenario general, dal manifest diagnostico)
| Fattore | Valore attuale | Prudente | Centrale | Ottimista | Provenienza economica |
|---|---:|---:|---:|---:|---|
| MOMENTUM | 3,50% | 1,50% | 2,50% | 3,50% | **UNVERIFIED** |
| VALUE | 1,20% | 0,75% | 1,75% | 2,50% | **UNVERIFIED** |
| SIZE_SMALL_CAP | 1,00% | 0,00% | 0,75% | 1,50% | **UNVERIFIED** |

Le tre colonne sono **ipotesi di sensibilità**, non rendimenti stimati o approvati. Non è stato reperito nel codice consultato un report che dimostri benchmark, serie dei rendimenti, periodo, valuta, formula di estrazione del premio e indipendenza rispetto a GLOBAL_EQUITY. La presenza dei campi `provenance` e `methodology` nello schema **non prova** che siano valorizzati o validi nel database live.

## Formula e rischio di doppio conteggio
Il motore aggrega `monthly ETF return = Σ(beta × monthly factor return) + annual specific alpha / 12 + residual shock × monthly residual volatility`.
La coesposizione mercato+stile non dimostra doppio conteggio. Tuttavia, sommare un rendimento di stile **totale** a GLOBAL_EQUITY sovrastimerebbe il rendimento. L'aggregazione è giustificata solo se la componente stilistica è **incrementale/excess return** rispetto al mercato, o se è stata ortogonalizzata e la sua interpretazione è documentata.

| ETF | GLOBAL_EQUITY beta | Altri beta | General attuale | General centrale (sensibilità) |
|---|---:|---|---:|---:|
| IE00BL25JP72 | 0,82 | MOMENTUM 0,75 | 9,68% | ~8,95% |
| IE0003R87OG3 | 0,70 | VALUE 0,70; QUALITY 0,20; SIZE_SMALL_CAP 0,85 | 8,17% | ~8,34% |
| IE00BP3QZB59 | 1,00 | VALUE 0,30 | 9,01% | ~9,17% |

I rendimenti in tabella sono **location mensili × 12** (aritmetici annualizzati), non CAGR, non rendimento storico, non media simulata. SIZE_SMALL_CAP è raggruppato sotto `other` nella scomposizione diagnostica V6 precedente, anche se nel catalogo è famiglia `style`: differenza di etichettatura da documentare, non assenza del fattore.

## Scenari macroeconomici
La sensitivity attuale applica per ogni fattore e scenario: `target_scenario_proposto = target_scenario_originale + (target_general_proposto - target_general_originale)`. Poi converte in location mensile in base a `returnMode`. Questo **non calibra** le performance condizionali storiche dei regimi: preserva solo gli scarti nei target annuali. Le correlazioni PSD, la completezza dei fattori e l'integrità del manifest sono controlli tecnici distinti dalla validazione economica.

## Evidenze richieste per la validazione finale
1. Per MOMENTUM, VALUE e SIZE_SMALL_CAP: serie fattoriale (o fonte), definizione long/short o long-only, benchmark equity, frequenza, valuta, periodo e rendimento totale vs premio excess.
2. Procedura di stima (media storica, shrinkage, forward-looking), gestione dei costi, confidence, peso historical/structural e motivazione del valore `general` e dei quattro regimi.
3. Evidenza di regressione/ortogonalizzazione contro GLOBAL_EQUITY e valutazione di `specific alpha` per gli ETF con coesposizione.
4. Estratto read-only da DB tramite `factor-calibration.sql`, confrontato con il manifest immutabile del run.
5. Backtest out-of-sample, controllo di sensitività e confronto CAGR/volatilità/drawdown solo **dopo** approvazione delle ipotesi.

## Audit finale
| Check | Esito |
|---|---|
| Struttura e percorso del modello V6 | PASS (code review statica) |
| Manifest di generazione | PASS (diagnostica utente) |
| Completezza delle righe di scenario | PASS (diagnostica utente) |
| Tracciabilità economica delle tre stime | **UNVERIFIED** |
| Premi incrementali sopra GLOBAL_EQUITY | **UNVERIFIED** |
| Doppio conteggio escluso | **UNVERIFIED** |
| Verifica valori live nel database | **NOT_RUN** |
| Modifiche al DB / MU | **NONE** |

**Calibration status: REVIEW_REQUIRED.** Non è possibile dichiarare `NO UNSOURCED VALUES`: 3,50%, 1,20% e 1,00% sono autenticati come parametri di generazione ma **non** giustificati economicamente con una fonte indipendente. Nessuna correzione ai parametri deve essere eseguita finché questi controlli non sono chiusi.
