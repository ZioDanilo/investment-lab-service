# V6 — Historical Factor Premium Validator
Read-only validation for `MOMENTUM`, `VALUE`, `SIZE_SMALL_CAP`. No DB writes, MU regeneration, external network downloads, or hidden historical values.

## Input and source requirements
Obtain *monthly factor long-short/excess returns* from an auditable provider (e.g. Kenneth French Data Library, global/developed market series when appropriate), not the total returns of ETF Momentum/Value/Small Cap. Keep provider URL, download date, release version, time span, currency, market universe, factor methodology, and any currency conversion. Verify that the source's `Mkt-RF`, `Mom`, `HML`, and `SMB` definitions correspond to the modeled exposures; they may not, especially for Avantis Small Cap Value. Source datasets may be in percent; **divide by 100** to submit decimal monthly returns. Avoid mixing different regional samples or dates without explicit alignment.

The endpoint requires **admin authorization** and JSON body:
```json
{
  "source":"provider URL / dataset / version",
  "definition":"long_short_excess",
  "benchmark":"Mkt-RF developed markets",
  "currency":"USD",
  "asOf":"2026-10-21",
  "rows":[
    {"date":"2000-01","marketExcess":0.012,"MOMENTUM":0.006,"VALUE":-0.003,"SIZE_SMALL_CAP":0.004}
  ]
}
```
Example row is **synthetic and illustrative**. A valid request needs 36–2400 contiguous, unique monthly rows, same period for every series. Missing data must not be silently filled. POST `/market-universe/v2/historical-factor-validation` (router mount prefix depends on server). The request does not save the input or report.

## Output
For each factor: annualized arithmetic sample mean, annualized sample volatility, market beta/correlation, regression intercept, Newey-West HAC annual standard error (6 lags), approximate normal 95% interval, and 10-year rolling means where at least 120 months are supplied. Compare against V6 general targets 3.5%, 1.2%, 1.0%. The reported `COMPATIBLE_WITH_SAMPLE` only means that the target falls within the sample mean's approximate 95% interval; it is **not** evidence that a future premium is correct. All factors remain `REVIEW` until provenance, universe and independent replication are verified.

## Explicit exclusions
No historical data have yet been ingested. No macro-regime labels or conditional estimates are generated: recession, expansion, soft landing and stagflation validation remains `NOT_VALIDATED`. No ETF-specific historical beta regressions, factor orthogonalization, out-of-sample validation, automatic parameter updates, or Monte Carlo reruns are performed. A long-short factor premium can be market-correlated; market beta and alpha alone do not establish whether it can be added to a specific ETF's market exposure. Document this before approving a calibration.

## Reproducibility
Backend Jest test: `npm test -- --runInBand tests/monteCarloV6HistoricalFactorValidation.test.js`.
Existing static report: `docs/factor-calibration-report.md`. DB read-only inspection: `docs/factor-calibration.sql`.
