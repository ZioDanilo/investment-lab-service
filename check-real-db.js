require('dotenv').config();
const { Sequelize, QueryTypes } = require('sequelize');
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false,
});
(async () => {
  try {
    await sequelize.authenticate();
    console.log('AUTH_OK');

    const portfolios = await sequelize.query(
      'SELECT * FROM "portafogli" WHERE LOWER(CAST("nome" AS TEXT)) LIKE :n ORDER BY "dataCreazione" DESC LIMIT 20',
      { replacements: { n: '%ricerca%' }, type: QueryTypes.SELECT }
    );
    console.log('PORTFOLIOS=' + JSON.stringify(portfolios, null, 2));

    const sampleHoldings = await sequelize.query(
      'SELECT * FROM "portafoglio_etf" LIMIT 20',
      { type: QueryTypes.SELECT }
    );
    console.log('HOLDINGS=' + JSON.stringify(sampleHoldings, null, 2));

    const etfCorrelations = await sequelize.query(
      'SELECT * FROM "etf_correlations" LIMIT 20',
      { type: QueryTypes.SELECT }
    );
    console.log('CORR=' + JSON.stringify(etfCorrelations, null, 2));

    const macroStats = await sequelize.query(
      'SELECT * FROM "etf_macro_statistics" ORDER BY "isin", "macroScenario" LIMIT 20',
      { type: QueryTypes.SELECT }
    );
    console.log('MACRO=' + JSON.stringify(macroStats, null, 2));

  } catch (e) {
    console.error('ERR=' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
