'use strict';
const {auditStylePremiums}=require('../src/services/monteCarloV6StylePremiumAuditService');
const factorSnapshot={factors:[
  {id:1,code:'EQUITY_MARKET',returnMode:'compounded_return',statistics:{general:{expectedReturn:.08}}},
  {id:2,code:'MOMENTUM',returnMode:'compounded_return',statistics:{general:{expectedReturn:.12}}}
],etfs:[{isin:'TEST',exposures:[{factorId:1,beta:1},{factorId:2,beta:.5}]}]};
const manifestRecord={manifestSha256:'test',manifest:{factorSnapshot}};
describe('Monte Carlo V6 observational style audit',()=>{
  test('does not certify incremental premiums based on return mode',()=>{
    const result=auditStylePremiums({manifestRecord,manifestVerification:{status:'PASS'}});
    expect(result.readOnly).toBe(true);
    expect(result.status).toBe('EVIDENCE_REQUIRED');
    expect(result.factors[0].classification).toBe('UNVERIFIED');
    expect(result.etfExposures[0].potentialOverlap).toBe(true);
    expect(result.etfExposures[0].doubleCountingConfirmed).toBe(false);
  });
  test('reconciles contributions and reports zero-style sensitivity without changing inputs',()=>{
    const before=JSON.stringify(manifestRecord);
    const result=auditStylePremiums({manifestRecord,manifestVerification:{status:'PASS'}});
    const general=result.reconciliation[0].scenarios.general;
    expect(general.accountingCheck).toBe('PASS');
    expect(general.marketStyleCoExposure).toBe(true);
    expect(general.premiumSemantics).toBe('NOT_ESTABLISHED');
    expect(general.configuredAnnualizedArithmetic-general.withoutStyleAnnualizedArithmetic)
      .toBeCloseTo(general.incrementalStyleAnnualizedArithmetic,12);
    expect(result.reconciliationSummary.completeScenarioRows).toBe(1);
    expect(JSON.stringify(manifestRecord)).toBe(before);
  });
  test('refuses to use an unauthenticated snapshot',()=>{
    const result=auditStylePremiums({manifestRecord,manifestVerification:{status:'FAIL'}});
    expect(result.status).toBe('BLOCKED_UNVERIFIED_MANIFEST');
    expect(result.factors).toHaveLength(0);
    expect(result.manifestSha256).toBeNull();
  });
  test('does not coerce missing expected returns to zero',()=>{
    const result=auditStylePremiums({manifestRecord,manifestVerification:{status:'PASS'}});
    expect(result.factors[0].scenarioExpectedReturns.recession).toBeNull();
  });
});
