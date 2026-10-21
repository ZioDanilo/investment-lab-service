'use strict';
// V5 foundations: deterministic configuration fingerprint and conservative semantic gates.
// Observational only. No writes, regeneration, or automatic parameter reinterpretation.
const { createHash } = require('node:crypto');
const STYLE = new Set(['VALUE','MOMENTUM','QUALITY','LOW_VOLATILITY','GROWTH']);
const SCENARIOS = ['expansion','soft_landing','recession','stagflation'];
function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k,stable(value[k])]));
  return value;
}
const sha256 = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
// Compatibility with V5 manifests created before Date serialization was normalized.
// The old hash represented Date instances as {}, while PostgreSQL JSONB stored ISO strings.
// Only recognize known Sequelize timestamp fields, and never rewrite the immutable manifest.
const LEGACY_DATE_KEYS = new Set(['createdAt','updatedAt','deletedAt','validatedAt']);
function legacyDateShape(value) {
  if (Array.isArray(value)) return value.map(legacyDateShape);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) =>
    [k, LEGACY_DATE_KEYS.has(k) && typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$/.test(v) ? {} : legacyDateShape(v)]));
  return value;
}
const norm = value => String(value ?? '').trim().toUpperCase();
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const sameArray = (a,b) => Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((x,i)=>norm(x)===norm(b[i]));
function createGenerationManifest({factorSnapshot,macroSnapshot,seed,pathCount,monthCount,assetOrder}) {
  const manifest = {schemaVersion:5,generator:'factor_market_universe_v2',
    seed:Number(seed),pathCount:Number(pathCount),monthCount:Number(monthCount),
    assetOrder:assetOrder.map(norm),factorSnapshot,macroSnapshot};
  return {manifest,sha256:sha256(manifest)};
}
function verifyGenerationManifest(record, run = null) {
  if(!record)return {status:'UNVERIFIED',reason:'No generation-time manifest exists for this historical run.'};
  const m=record.manifest;
  if (!m || typeof m!=='object') return {status:'FAIL',reason:'Manifest payload is missing or invalid.'};
  const hash=sha256(m);
  const issues=[];
  const legacyHash = hash === record.manifestSha256 ? null : sha256(legacyDateShape(m));
  const legacyDateCompatibility = hash !== record.manifestSha256 && legacyHash === record.manifestSha256;
  if(hash!==record.manifestSha256 && !legacyDateCompatibility) issues.push('SHA256_MISMATCH');
  if(Number(record.schemaVersion)!==5 || m.schemaVersion!==5) issues.push('SCHEMA_VERSION_MISMATCH');
  if(!m.factorSnapshot || !m.macroSnapshot || !Array.isArray(m.assetOrder)) issues.push('INCOMPLETE_INPUT_SNAPSHOT');
  if(run) {
    if(String(record.runId)!==String(run.runId)) issues.push('RUN_ID_MISMATCH');
    for(const key of ['seed','pathCount','monthCount']) if(Number(m[key])!==Number(run[key])) issues.push(key.toUpperCase()+'_MISMATCH');
    if(!sameArray(m.assetOrder,run.assetOrder)) issues.push('ASSET_ORDER_MISMATCH');
    if(Number(run.assetCount)!==m.assetOrder?.length) issues.push('ASSET_COUNT_MISMATCH');
  }
  return {status:issues.length?'FAIL':'PASS',recordedSha256:record.manifestSha256,
    computedSha256:hash,legacyDateCompatibility,legacyComputedSha256:legacyDateCompatibility?legacyHash:null,issues,
    reason:issues.length?'Generation manifest failed integrity or run identity checks.':legacyDateCompatibility?'Legacy V5 hash verified after restoring the original Date serialization behavior; timestamp fields were not authenticated by that historical hash.':'Manifest hash, schema and run identity checks passed.'};
}
function buildMonteCarloV5Foundation({ factorSnapshot, run, scenarios, v3Audit, v4Validation, manifestRecord = null }) {
  const factors = (factorSnapshot.factors || []).map(f => ({
    id:f.id,code:f.code,returnMode:f.returnMode,statistics:f.statistics
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
  const invalidBetas = etfs.flatMap(e=>e.exposures.filter(x=>!finite(x.beta))
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
  const manifestVerification=verifyGenerationManifest(manifestRecord,run);
  add('GENERATION_TIME_MANIFEST',manifestVerification.status,
    'Generation-time manifest must be persisted and its SHA-256 must verify.',manifestVerification);
  add('MACRO_CONFIG_PROVENANCE',manifestVerification.status==='FAIL'?'FAIL':manifestVerification.status==='PASS' && manifestRecord.manifest.macroSnapshot?'PASS':'UNVERIFIED',
    'Original macro configuration must be included in the verified generation manifest.');
  add('BOND_FX_INSTRUMENT_METADATA','UNVERIFIED',
    'Verified duration, carry, base currency and hedge metadata are required for a bond/FX engine.');
  const failures=checks.filter(x=>x.status==='FAIL').length;
  return {
    version:5, mode:'FOUNDATIONS_READ_ONLY', readOnly:true,
    runId:run.runId, seed:run.seed, pathCount:run.pathCount,monthCount:run.monthCount,
    configuration:{
      currentFactorSnapshotSha256:sha256(config),
      currentFactorCount:factors.length,currentEtfCount:etfs.length,
      generationTimeSha256:manifestRecord?.manifestSha256??null,
      provenance:manifestVerification.status==='PASS'?'VERIFIED_GENERATION_TIME_MANIFEST':'CURRENT_LIVE_SNAPSHOT_ONLY',
      historicallyReproducible:false,
      generationInputsTraceable:manifestVerification.status==='PASS',
      caveat:manifestVerification.status==='PASS'?'Generation inputs are authenticated against the stored run metadata. Bit-for-bit replay still requires a pinned runtime version and replay test.':'The current snapshot hash does not authenticate historical generation inputs.'
    },
    semantics:{stylePremia:style, returnConvention:'simple_monthly',
      verifiedIncrementalPremia:false, policy:'No automatic conversion of factor returns or alpha.'},
    scenarioCoverage:SCENARIOS.map(s=>({scenario:s,share:scenarios.find(x=>x.scenario===s)?.share??null})),
    previousValidation:{v4Status:v4Validation?.status??null,v3Certification:v3Audit?.certification?.status??null},
    checks, status:failures?'FAILED':manifestVerification.status==='PASS'?'INPUT_PROVENANCE_VERIFIED':'FOUNDATIONS_INCOMPLETE',
    nextReleaseRequirements:[
      'Pin generator build identity and perform independent seeded replay before claiming full reproducibility.',
      'Establish source-backed incremental style premia and prevent double counting.',
      'Validate bond duration/carry and currency/hedge instrument metadata.',
      'Apply and run automated tests for integrity, run identity and economic gates.'
    ]
  };
}
module.exports={buildMonteCarloV5Foundation,createGenerationManifest,verifyGenerationManifest,sha256};
