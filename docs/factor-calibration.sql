-- V6 FACTOR CALIBRATION AUDIT — READ ONLY
-- 2026-10-21. Execute against the active PostgreSQL database.
-- Intentionally NO INSERT, UPDATE, DELETE, DDL, COMMIT or generator call.
BEGIN TRANSACTION READ ONLY;
-- 1. Number of active factors and their scenario rows.
SELECT COUNT(*) FILTER (WHERE active) AS active_factors, COUNT(*) AS all_factors
FROM factors;
SELECT f.code, f.family, f."returnMode",
       COUNT(s.id) AS scenario_rows,
       COUNT(DISTINCT s."macroScenario") AS distinct_scenarios
FROM factors f
LEFT JOIN factor_scenario_statistics s ON s."factorId" = f.id
WHERE f.active
GROUP BY f.id, f.code, f.family, f."returnMode"
ORDER BY f.code;
-- 2. Current factor targets, provenance, and methodology for the three candidate premiums.
SELECT f.code, f.family, f."returnMode",
       s."macroScenario", s."expectedReturn", s.volatility,
       s."historicalWeight", s."structuralWeight", s.confidence,
       s.provenance, s.methodology, s."observedAt"
FROM factors f
JOIN factor_scenario_statistics s ON s."factorId" = f.id
WHERE f.code IN ('MOMENTUM','VALUE','SIZE_SMALL_CAP','GLOBAL_EQUITY')
ORDER BY f.code, s."macroScenario";
-- 3. Coexposure and alpha. Beta estimates are NOT a proof of economic orthogonality.
SELECT e.isin, f.code AS factor_code, x.beta,
       x."historicalBeta", x."structuralBeta",
       x."historicalWeight", x."structuralWeight",
       x.confidence, x.provenance
FROM etf_factor_exposures x
JOIN factors f ON f.id = x."factorId"
JOIN anagrafica_etf e ON e.id = x."etfId"
WHERE e.isin IN ('IE00BL25JP72','IE0003R87OG3','IE00BP3QZB59')
ORDER BY e.isin, f.code;
SELECT e.isin, r.alpha, r."residualVolatility", r."annualizedVolatility", r.confidence
FROM etf_specific_risks r
JOIN anagrafica_etf e ON e.id = r."etfId"
WHERE e.isin IN ('IE00BL25JP72','IE0003R87OG3','IE00BP3QZB59')
ORDER BY e.isin;
-- 4. Detect duplicate scenario rows or missing scenario combinations.
SELECT f.code, s."macroScenario", COUNT(*) AS duplicate_count
FROM factor_scenario_statistics s JOIN factors f ON f.id=s."factorId"
GROUP BY f.code,s."macroScenario" HAVING COUNT(*)>1;
SELECT f.code, sc.scenario AS missing_scenario
FROM factors f
CROSS JOIN (VALUES ('general'),('expansion'),('soft_landing'),('recession'),('stagflation')) sc(scenario)
LEFT JOIN factor_scenario_statistics s ON s."factorId"=f.id AND s."macroScenario"::text=sc.scenario
WHERE f.active AND s.id IS NULL ORDER BY f.code,sc.scenario;
-- 5. Count correlation pairs per macro regime; expected N*(N-1)/2 for N active factors
-- only when all active factors participate and each pair appears exactly once.
SELECT "macroScenario",COUNT(*) AS correlation_rows,
       COUNT(*) FILTER (WHERE correlation < -1 OR correlation > 1) AS out_of_range
FROM factor_correlations GROUP BY "macroScenario" ORDER BY "macroScenario";
ROLLBACK;
