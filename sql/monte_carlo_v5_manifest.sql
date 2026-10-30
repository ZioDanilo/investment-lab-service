-- Monte Carlo V5: apply once before generating V5 runs.
-- Historical runs remain unchanged and have no manifest.
CREATE TABLE IF NOT EXISTS monte_carlo_run_manifest (
  run_id UUID PRIMARY KEY REFERENCES market_universe_run_v2(run_id) ON DELETE RESTRICT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 5),
  manifest_sha256 VARCHAR(64) NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Immutable at database level, including updates to existing manifests.
CREATE OR REPLACE FUNCTION reject_monte_carlo_manifest_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Monte Carlo run manifests are immutable';
END;
$$;
DROP TRIGGER IF EXISTS trg_monte_carlo_manifest_immutable ON monte_carlo_run_manifest;
CREATE TRIGGER trg_monte_carlo_manifest_immutable
BEFORE UPDATE OR DELETE ON monte_carlo_run_manifest
FOR EACH ROW EXECUTE FUNCTION reject_monte_carlo_manifest_mutation();
