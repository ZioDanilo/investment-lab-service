# V6 — Empirical factor calibration and coherence audit (2026-10-21)

## Sources and limitations
User-provided Kenneth French **Developed_5_Factors.csv** and **Developed_MOM_Factor.csv**, monthly percent returns converted to decimal, 1990-11 through 2026-08 (430 observations); iShares fund export XML spreadsheets (Core MSCI World, Momentum, Quality, Minimum Volatility), monthly changes in the **Serie Fund Return** cumulative return index, USD, aligned through 2026-08. No data written to DB. Source files are conversation attachments, not stored in GitHub.

Factor means are arithmetic monthly means ×12. Confidence intervals are HAC/Newey-West (lag 6), 95%, normal approximation. Academic long-short returns are not investable ETF premiums and can differ from the ETF index definitions.

| Factor | 1990-2026 annual mean | HAC 95% interval | Latest 120 months | Current V6 general premium |
|---|---:|---:|---:|---:|
| MOMENTUM (WML) | 6.522% | [1.96%,11.08%] | 4.16% | 3.50% |
| VALUE (HML) | 3.297% | [-0.77%,7.37%] | 1.20% | 1.20% |
| SIZE_SMALL_CAP (SMB) | 0.346% | [-1.93%,2.62%] | -2.84% | 1.00% |

120-month rolling annual mean ranges: Momentum -0.02% to 13.12%, Value -5.67% to 12.66%, SMB -3.46% to 5.71%. The historical sample does **not** establish a stable positive SMB premium.

## ETF six-factor regressions
OLS of ETF monthly return minus RF on Developed Mkt-RF, SMB, HML, RMW, CMA and WML, plus intercept; Newey-West lag-6 inference. Coefficients are empirical sensitivities to this particular Developed factor construction, not automatically valid structural exposures. All ETF monthly returns use the same USD Fund Return series. ETF returns overlap French data through August 2026.

| ETF | Months | R² | Market beta | SMB | HML | RMW | CMA | WML | Annual regression intercept |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MSCI World | 203 | .998 | 1.001 | -.146 | -.004 | .045 | .014 | .002 | -.392% |
| Momentum | 142 | .938 | 1.066 | -.243 | -.104 | -.225 | .115 | .549 | -.862% |
| Quality | 142 | .974 | .983 | -.145 | -.036 | .275 | .087 | .038 | -.939% |
| Minimum Volatility | 165 | .784 | .700 | .051 | -.096 | .613 | .517 | .072 | -1.937% |

Momentum WML coefficient p<0.001, market p<0.001; HML, RMW, CMA are not statistically distinguishable from zero in this sample. Momentum SMB negative and significant. Quality RMW positive and significant; Minimum Volatility RMW and CMA positive and significant. Intercepts are not statistically significant for Momentum, Quality or Minimum Volatility. World intercept small negative, p=.044.

**Interpretation:** current V6 Momentum ETF GLOBAL_EQUITY 0.82 / MOMENTUM 0.75 diverges from empirical 1.066 / 0.549; but the latter is a *six-factor* fit and also implies negative SMB exposure. Changing only two betas without representing the other coefficients would alter the fitted behavior and is **not** approved. World ETF's -0.146 SMB illustrates benchmark-definition mismatch: the academic Developed market factor is not the MSCI World index.

## Candidate general-factor calibration
**Maintain current general expected premiums pending review:** MOMENTUM 3.50%, VALUE 1.20%, SIZE_SMALL_CAP 1.00%. These lie within the historical 95% sample intervals. SMB 1.00% is a **weak, uncertain forward assumption**, not empirically validated; a sensitivity test at 0% is mandatory before approval. Momentum sensitivity: 2.50%, 3.50%, 4.50%; Value: 0.50%, 1.20%, 2.00%; SMB: 0%, 0.50%, 1.00%. These are **proposed stress values**, not new database values or estimated true premia.

**Candidate Momentum ETF empirical diagnostic:** market 1.066, WML .549, SMB -.243 (plus other estimated exposures above), only for an offline replay / out-of-sample comparison. Do not replace V6 exposures yet. Compare current vs six-factor candidate against observed ETF return, volatility, tracking error, drawdown and rolling regressions, using consistent factor means and residual variance. Calibrate factor covariance simultaneously to avoid double counting.

## Coherence gates — current status
- Historical long-short factor data: PASS (430 aligned months).
- ETF return/factor alignment: PASS (USD monthly aligned).
- Empirical market and style sensitivities: ESTIMATED, not stable/out-of-sample validated.
- Factor premium sampling uncertainty: QUANTIFIED.
- Definition equivalence (French Developed vs MSCI World ETF indices): REVIEW_REQUIRED.
- Small Cap Value and Value ETF validation: BLOCKED (no ETF history in uploaded set).
- Incremental expected returns vs market baseline: REVIEW_REQUIRED (beta, covariance, factor means must be calibrated jointly).
- Macro regimes expansion/soft_landing/recession/stagflation: NOT_VALIDATED (no independently defined regime labels).
- Parameter changes or MU regeneration: **NOT EXECUTED**.

## Decision
**Do not write new parameters to DB yet.** Current general premium assumptions remain defensible under sample uncertainty, but Momentum ETF structural betas require a targeted model-consistency check. Next: out-of-sample rolling/holdout regression and model-implied return/variance comparisons, plus Value/Small Cap Value ETF data if available. Scenario premia require external regime definitions.
