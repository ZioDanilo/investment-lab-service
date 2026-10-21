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
