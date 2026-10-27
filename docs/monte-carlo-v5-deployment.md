# Monte Carlo V5 — technical acceptance and handover

## Scope
V5 provides an immutable generation-time factor/macro manifest, run-identity checks, SHA-256 verification, and conservative read-only diagnostics. It does not recalibrate returns, correlations, macro regimes or ETF risk.

## Observed production diagnostic (2026-10-21 13:17:38 UTC)
Active run: `343568bd-3fe6-4935-8525-a849f384df19` (seed 42, 1,000 paths, 360 months, 26 ETFs).
Status: `INPUT_PROVENANCE_VERIFIED`; 5 PASS, 0 FAIL, 2 UNVERIFIED:
- PASS: `UNIQUE_FACTOR_IDS`, `ETF_FACTOR_REFERENCES`, `FINITE_FACTOR_BETAS`, `GENERATION_TIME_MANIFEST`, `MACRO_CONFIG_PROVENANCE`.
- UNVERIFIED: `INCREMENTAL_STYLE_PREMIA`, `BOND_FX_INSTRUMENT_METADATA` (economic validation, not silently treated as PASS).
- V4 validation and V3 economic certification remain unverified/not certified.

The active run uses legacy timestamp hashing compatibility. Its stored hash `0b870943a64f2f144d4fe6ba69a348431851c858f4a81c0626c150fc3b749dc0` matches the reconstructed historical serialization; timestamp fields were **not authenticated** by the original hash. New manifests serialize Date values as ISO strings. Do not rewrite the immutable legacy manifest or imply that timestamps were verified.

## Test execution
From the backend repository, with dependencies installed:
```sh
npm test -- --runInBand tests/monteCarloV5Foundation.test.js
```
The tests cover deterministic hashing, Date JSON roundtrip, legacy Date compatibility, tamper detection, run identity and dimensions, invalid beta rejection, and conservative style-premium gates.

**Test execution status:** not independently observed yet. Do not report the test suite as PASS until an actual runner exits successfully.

## Acceptance / remaining boundaries
- The manifest and macro provenance PASS on the persisted active run, without regeneration or writes.
- Historical run integrity is subject to the explicitly documented timestamp limitation.
- No economic calibration or bit-for-bit replay certification is claimed.
- The V6 workstream owns style premium evidence, bond/FX metadata, macro validation, pinned runtime identity and seeded replay.
- Database migration: `sql/monte_carlo_v5_manifest.sql`; future generation requires the manifest table and must fail closed when it is unavailable.
