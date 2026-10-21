'use strict';
// V5 foundations: deterministic configuration fingerprint and conservative semantic gates.
// Observational only. No writes, regeneration, or automatic parameter reinterpretation.
const { createHash } = require('node:crypto');
const STYLE = new Set(['VALUE','MOMENTUM','QUALITY','LOW_VOLATILITY','GROWTH']);
const SCENARIOS = ['expansion','soft_landing','recession','stagflation'];
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k,stable(value[k])]));
  return value;
}
const sha256 = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const norm = value => String(value ?? '').trim().toUpperCase();
function buildMonteCarloV5Foundation({ factorSnapshot, run, scenarios, v3Audit, v4Validation }) {
  const factors = (factorSnapshot.factors || []).map(f => ({
    id:f.id,code:f.code,returnMode:f.returnMode,
    scenarios:f.scenarios ?? f.scenarioParameters ?? null
  }));
  const etfs = (factorSnapshot.etfs || []).map(e => ({
    isin:norm(e.isin),exposures:(e.exposures || []).map(x=>({factorId:x.factorId,beta:x.beta})),
    specificRisk:e.specificRisk
  }));
  const config = { factors, correlations:factorSnapshot.correlations, etfs };
  const checks = [];
  const add=(id,status,detail,evidence)=>checks.push({id,status,detail,evidence});
  const duplicateIds = factors.map(f=>String(f.id)).filter((id,i,all)=>all.indexOf(id)!==i);
  add('UNIQUE_FACTOR_IDS',duplicateIds.length?'FAIL':'PASS',
    'Each factor must have a unique identifier.',{duplicateIds:[...new Set(duplicateIds)]});
  const missingFactorIds = new Set();
  const factorIds = new Set(factors.map(f=>String(f.id)));
  for(const e of etfs) for(const x of e.exposures)
    if(!factorIds.has(String(x.factorId))) missingFactorIds.add(String(x.factorId));
  add('ETF_FACTOR_REFERENCES',missingFactorIds.size?'FAIL':'PASS',
    'All ETF exposures must reference an existing factor.',{missingFactorIds:[...missingFactorIds]});
  const invalidBetas = etfs.flatMap(e=>e.exposures.filter(x=>!Number.isFinite(Number(x.beta)))
    .map(x=>({isin:e.isin,factorId:x.factorId,beta:x.beta})));
  add('FINITE_FACTOR_BETAS',invalidBetas.length?'FAIL':'PASS',
    'Factor exposures must be finite.',{invalidBetas});
  const style = factors.filter(f=>STYLE.has(norm(f.code))).map(f=>({
    code:norm(f.code),returnMode:f.returnMode,
    incrementalPremiumVerified:false,
    reason:'Return mode is not evidence that the calibration target is an excess return over the equity market.'
  }));
  add('INCREMENTAL_STYLE_PREMIA','UNVERIFIED',
    'Require source-backed incremental style premium definitions before changing expected returns.',
    {factors:style.map(s=>s.code)});
  add('GENERATION_TIME_MANIFEST','UNVERIFIED',
    'The V2 run table has no persisted immutable configuration manifest. Current hash cannot authenticate historical inputs.');
  add('MACRO_CONFIG_PROVENANCE','UNVERIFIED',
    'The original macro transition, inertia and intensity configuration is not persisted with this run.');
  add('BOND_FX_INSTRUMENT_METADATA','UNVERIFIED',
    'Verified duration, carry, base currency and hedge metadata are required for a bond/FX engine.');
  const failures=checks.filter(x=>x.status==='FAIL').length;
  return {
    version:5, mode:'FOUNDATIONS_READ_ONLY', readOnly:true,
    runId:run.runId, seed:run.seed, pathCount:run.pathCount,monthCount:run.monthCount,
    configuration:{
      currentFactorSnapshotSha256:sha256(config),
      currentFactorCount:factors.length,currentEtfCount:etfs.length,
      generationTimeSha256:null,provenance:'CURRENT_LIVE_SNAPSHOT_ONLY',
      historicallyReproducible:false,
      caveat:'This hash is not a generation-time manifest and must not be presented as proof of historical reproducibility.'
    },
    semantics:{stylePremia:style, returnConvention:'simple_monthly',
      verifiedIncrementalPremia:false, policy:'No automatic conversion of factor returns or alpha.'},
    scenarioCoverage:SCENARIOS.map(s=>({scenario:s,share:scenarios.find(x=>x.scenario===s)?.share??null})),
    previousValidation:{v4Status:v4Validation?.status??null,v3Certification:v3Audit?.certification?.status??null},
    checks, status:failures?'FAILED':'FOUNDATIONS_INCOMPLETE',
    nextReleaseRequirements:[
      'Persist immutable generation-time factor and macro manifest in versioned storage.',
      'Establish source-backed incremental style premia and prevent double counting.',
      'Validate bond duration/carry and currency/hedge instrument metadata.',
      'Add regression tests for manifest determinism and fail-closed economic gates.'
    ]
  };
}
module.exports={buildMonteCarloV5Foundation};
