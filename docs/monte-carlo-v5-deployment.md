# Monte Carlo V5 — deploy and acceptance

## Deployment order
1. Apply `sql/monte_carlo_v5_manifest.sql` to the PostgreSQL database.
2. Deploy the backend `montecarlo` branch.
3. Deploy the frontend `montecarlo` branch.
4. Run `npm test -- --runInBand tests/monteCarloV5Foundation.test.js` in the backend.
5. Open the diagnostics against the **existing** run: `GENERATION_TIME_MANIFEST` must be `UNVERIFIED` (no retroactive manifest).
6. Only after explicit approval, generate a **new** run. Check the row in `monte_carlo_run_manifest` and confirm `GENERATION_TIME_MANIFEST = PASS` and `MACRO_CONFIG_PROVENANCE = PASS`.

## Compatibility and safety
- Existing runs are preserved and remain readable. Their historical provenance is unknown.
- New generations fail closed when the migration is missing.
- A database trigger forbids updating or deleting an existing manifest.
- The V5 generation uses the same return and macro engines and the same parameters as V2; this is not the economic V6 upgrade.
- SHA-256 verifies persisted manifest integrity, not financial calibration or the actual runtime version. A future upgrade should include a build commit SHA and independently replay a seeded sample path.
- Style factors are **not** automatically classified as incremental excess returns. Do not change their numerical expected returns without calibration evidence.
- Duration, carry, credit and FX hedging still require verified instrument metadata; V5 reports these as unverified, not as passed.

## Acceptance criteria
- No automatic regeneration or mutation of historical runs.
- Deterministic manifest digest, tampering detected, style semantics remain unverified without evidence.
- New runs persist factor + macro inputs before the first simulated month.
- Diagnostics use verified generation-time factors when available.
- Existing reports retain their V3 and V4 sections.
