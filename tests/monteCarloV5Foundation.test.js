'use strict';
const {createGenerationManifest,verifyGenerationManifest,sha256,buildMonteCarloV5Foundation}
  =require('../src/services/monteCarloV5FoundationService');
const snapshot={factors:[{id:1,code:'MOMENTUM',returnMode:'compounded_return',
  statistics:{general:{expectedReturn:.08,volatility:.2}}}],
  correlations:{expansion:{}},etfs:[{isin:'TEST',exposures:[{factorId:1,beta:1}],
    specificRisk:{alpha:0,residualVolatility:.1}}]};
const macro={transitionMatrix:{expansion:{expansion:.9}},inertia:{},intensity:{}};
const options={factorSnapshot:snapshot,macroSnapshot:macro,seed:42,pathCount:1000,monthCount:360,assetOrder:['TEST']};
describe('Monte Carlo V5 manifest',()=>{
  test('same inputs produce the same digest despite object key ordering',()=>{
    const a=createGenerationManifest(options);
    const b=createGenerationManifest({...options,macroSnapshot:{intensity:{},inertia:{},
      transitionMatrix:{expansion:{expansion:.9}}}});
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('detects tampering and missing historical manifests',()=>{
    const a=createGenerationManifest(options);
    expect(verifyGenerationManifest({manifest:a.manifest,manifestSha256:a.sha256}).status).toBe('PASS');
    expect(verifyGenerationManifest({manifest:{...a.manifest,seed:43},manifestSha256:a.sha256}).status).toBe('FAIL');
    expect(verifyGenerationManifest(null).status).toBe('UNVERIFIED');
  });
  test('rejects manifest attached to the wrong run or with mismatched dimensions',()=>{
    const a=createGenerationManifest(options);
    const run={runId:'r1',seed:42,pathCount:1000,monthCount:360,assetOrder:['TEST'],assetCount:1};
    const record={runId:'r1',schemaVersion:5,manifest:a.manifest,manifestSha256:a.sha256};
    expect(verifyGenerationManifest(record,run).status).toBe('PASS');
    expect(verifyGenerationManifest(record,{...run,runId:'r2'}).issues).toContain('RUN_ID_MISMATCH');
    expect(verifyGenerationManifest(record,{...run,monthCount:120}).issues).toContain('MONTHCOUNT_MISMATCH');
    expect(verifyGenerationManifest(record,{...run,assetOrder:['OTHER']}).issues).toContain('ASSET_ORDER_MISMATCH');
    expect(verifyGenerationManifest({...record,schemaVersion:4},run).status).toBe('FAIL');
  });
  test('missing beta must fail rather than coerce null to zero',()=>{
    const invalid={...snapshot,etfs:[{...snapshot.etfs[0],exposures:[{factorId:1,beta:null}]}]};
    const report=buildMonteCarloV5Foundation({factorSnapshot:invalid,
      run:{runId:'r',seed:42,pathCount:1000,monthCount:360},scenarios:[]});
    expect(report.checks.find(x=>x.id==='FINITE_FACTOR_BETAS').status).toBe('FAIL');
  });
  test('a verified manifest certifies inputs, not a bit-for-bit replay',()=>{
    const a=createGenerationManifest(options);
    const run={runId:'r1',seed:42,pathCount:1000,monthCount:360,assetOrder:['TEST'],assetCount:1};
    const report=buildMonteCarloV5Foundation({factorSnapshot:snapshot,run,scenarios:[],
      manifestRecord:{runId:'r1',schemaVersion:5,manifest:a.manifest,manifestSha256:a.sha256}});
    expect(report.configuration.generationInputsTraceable).toBe(true);
    expect(report.configuration.historicallyReproducible).toBe(false);
    expect(report.checks.find(x=>x.id==='GENERATION_TIME_MANIFEST').status).toBe('PASS');
  });
  test('style premiums are never silently certified or reinterpreted',()=>{
    const report=buildMonteCarloV5Foundation({factorSnapshot:snapshot,
      run:{runId:'r',seed:42,pathCount:1000,monthCount:360},scenarios:[],
      v3Audit:null,v4Validation:null});
    expect(report.semantics.verifiedIncrementalPremia).toBe(false);
    expect(report.checks.find(x=>x.id==='INCREMENTAL_STYLE_PREMIA').status).toBe('UNVERIFIED');
    expect(report.configuration.historicallyReproducible).toBe(false);
  });
  test('fingerprint changes if a calibration input changes',()=>{
    expect(sha256(options)).not.toBe(sha256({...options,seed:43}));
  });
});
