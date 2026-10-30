'use strict';
const { calibrateReturnsV6 } = require('../src/services/monteCarloV6ReturnCalibrationService');

const factor = (id, code, ret, returnMode='compounded_return') => ({
  id, code, returnMode, statistics:Object.fromEntries(
    ['general','expansion','soft_landing','recession','stagflation'].map(s=>[s,{expectedReturn:ret}])
  )
});
const manifestRecord={manifestSha256:'test-sha',manifest:{factorSnapshot:{
  factors:[factor('g','GLOBAL_EQUITY',0.0865),factor('m','MOMENTUM',0.035),factor('v','VALUE',0.012),factor('s','SIZE_SMALL_CAP',0.01)],
  etfs:[{isin:'IE00BL25JP72',exposures:[{factorId:'g',beta:0.82},{factorId:'m',beta:0.75}],specificRisk:{alpha:0}},
        {isin:'IE0003R87OG3',exposures:[{factorId:'g',beta:0.7},{factorId:'v',beta:0.7},{factorId:'s',beta:0.85}],specificRisk:{alpha:0}}]
}}};
describe('V6 returns calibration: read-only scenario sensitivities',()=>{
  test('blocks unverified original generation manifest',()=>{
    const result=calibrateReturnsV6({manifestRecord,manifestVerification:{status:'FAIL'}});
    expect(result.status).toBe('BLOCKED_UNVERIFIED_MANIFEST');
    expect(result.etfs).toHaveLength(0);
  });
  test('covers all ETF factors and scenarios without mutating the snapshot',()=>{
    const before=JSON.stringify(manifestRecord);
    const result=calibrateReturnsV6({manifestRecord,manifestVerification:{status:'PASS'}});
    expect(result.readOnly).toBe(true);
    expect(result.etfCount).toBe(2);
    expect(result.scenarioCount).toBe(5);
    expect(result.checks.find(x=>x.id==='ALL_SCENARIO_ROWS_COMPLETE').status).toBe('PASS');
    expect(result.etfs[0].scenarios.general.candidates.central.deltaAnnualizedArithmetic).toBeLessThan(0);
    expect(result.etfs[1].scenarios.general.candidates.central.deltaAnnualizedArithmetic).toBeGreaterThan(0);
    expect(result.etfs[1].exposures.find(x=>x.code==='SIZE_SMALL_CAP').beta).toBe(0.85);
    expect(result.etfs[1].scenarios.general.factors.find(x=>x.code==='SIZE_SMALL_CAP').group).toBe('other');
    expect(JSON.stringify(manifestRecord)).toBe(before);
  });
  test('reports incomplete rows instead of inventing missing factor returns',()=>{
    const broken=JSON.parse(JSON.stringify(manifestRecord));
    delete broken.manifest.factorSnapshot.factors[1].statistics.general;
    const result=calibrateReturnsV6({manifestRecord:broken,manifestVerification:{status:'PASS'}});
    expect(result.etfs[0].scenarios.general.complete).toBe(false);
    expect(result.etfs[0].scenarios.general.candidates.central.annualizedArithmetic).toBeNull();
  });
});
