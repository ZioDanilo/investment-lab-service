'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {calculateMomentValidation}=require('../services/monteCarloMomentValidationService');
const stats={general:{expectedReturn:0.12,volatility:0.12},
  expansion:{expectedReturn:0.12,volatility:0.12},
  soft_landing:{expectedReturn:0.12,volatility:0.12},
  recession:{expectedReturn:0.12,volatility:0.12},
  stagflation:{expectedReturn:0.12,volatility:0.12}};
const snapshot={factorOrder:[1],factors:[{id:1,code:'MARKET',returnMode:'additive_shock',statistics:stats}],
  correlations:{expansion:{},soft_landing:{},recession:{},stagflation:{}},
  etfs:[{isin:'TEST',exposures:[{factorId:1,beta:1}],specificRisk:{alpha:0,residualVolatility:0}}]};
test('V4 analytical moments match a single-factor additive generator',()=>{
  const out=calculateMomentValidation({snapshot,etfs:[{isin:'TEST',meanMonthlyReturn:.01,
    realizedAnnualVolatility:.12}],correlations:[],scenarioBytes:Buffer.from([0,1,2,3]),
    intensity:new Float32Array([0,.5,1,.25]),run:{runId:'test'}});
  assert.equal(out.status,'UNVERIFIED');
  assert.ok(Math.abs(out.etfs[0].expectedAnnualArithmeticReturn-.12)<1e-12);
  assert.ok(Math.abs(out.etfs[0].expectedAnnualVolatility-.12)<1e-12);
  assert.equal(out.currentConfigurationSha256.length,64);
});
test('V4 rejects invalid timeline intensity without certifying',()=>{
  const out=calculateMomentValidation({snapshot,etfs:[{isin:'TEST',meanMonthlyReturn:0,
    realizedAnnualVolatility:0}],correlations:[],scenarioBytes:Buffer.from([0]),
    intensity:new Float32Array([NaN]),run:{runId:'test'}});
  assert.equal(out.status,'UNVERIFIED');
  assert.equal(out.invalid,1);
});
