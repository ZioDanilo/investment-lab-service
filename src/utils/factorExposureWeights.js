const exposureWeightsForHistory = (years) => {
  const y = Number(years);
  if (!Number.isFinite(y) || y < 10) return { historicalWeight: 0.2, structuralWeight: 0.8 };
  if (y <= 20) return { historicalWeight: 0.6, structuralWeight: 0.4 };
  return { historicalWeight: 0.8, structuralWeight: 0.2 };
};

module.exports = { exposureWeightsForHistory };
