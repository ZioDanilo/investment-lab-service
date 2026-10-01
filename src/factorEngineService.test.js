const { exposureWeightsForHistory } = require('./services/factorEngineService');

describe('Factor Engine V2 exposure weighting', () => {
  test('uses 20/80 below 10 years', () => expect(exposureWeightsForHistory(9.99)).toEqual({ historicalWeight: 0.2, structuralWeight: 0.8 }));
  test('uses 60/40 from 10 through 20 years', () => {
    expect(exposureWeightsForHistory(10)).toEqual({ historicalWeight: 0.6, structuralWeight: 0.4 });
    expect(exposureWeightsForHistory(20)).toEqual({ historicalWeight: 0.6, structuralWeight: 0.4 });
  });
  test('uses 80/20 above 20 years', () => expect(exposureWeightsForHistory(20.01)).toEqual({ historicalWeight: 0.8, structuralWeight: 0.2 }));
});
