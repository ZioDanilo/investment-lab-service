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

    const portfolio = await sequelize.query(
      `SELECT id, nome, descrizione, "dataCreazione", "dataModifica"
       FROM "portafogli"
       WHERE LOWER(CAST("nome" AS TEXT)) = LOWER(:name)
       LIMIT 1`,
      { replacements: { name: 'Ricerca azionario' }, type: QueryTypes.SELECT }
    );

    console.log('PORTFOLIO=' + JSON.stringify(portfolio, null, 2));

    const holdings = await sequelize.query(
      `SELECT p.id AS portfolio_id, p.nome AS portfolio_name,
              pe."peso" AS weight_pct,
              e.id AS etf_id, e.isin, e.name, e.ticker, e.description,
              e."assetClass"
       FROM "portafogli" p
       JOIN "portafoglio_etf" pe ON pe."portafoglioId" = p.id
       JOIN "anagrafica_etf" e ON e.id = pe."etfId"
       WHERE LOWER(CAST(p."nome" AS TEXT)) = LOWER(:name)
       ORDER BY CAST(pe."peso" AS numeric) DESC, e.name ASC`,
      { replacements: { name: 'Ricerca azionario' }, type: QueryTypes.SELECT }
    );
    console.log('HOLDINGS=' + JSON.stringify(holdings, null, 2));

    const isins = [...new Set(holdings.map(h => h.isin))];
    if (isins.length) {
      const macro = await sequelize.query(
        `SELECT * FROM "etf_macro_statistics"
         WHERE "isin" IN (:isins)
         ORDER BY "isin", "macroScenario"`,
        { replacements: { isins }, type: QueryTypes.SELECT }
      );
      console.log('MACRO=' + JSON.stringify(macro, null, 2));

      const corr = await sequelize.query(
        `SELECT * FROM "etf_correlations"
         WHERE ("isin1" IN (:isins) AND "isin2" IN (:isins))
         ORDER BY "isin1", "isin2"`,
        { replacements: { isins }, type: QueryTypes.SELECT }
      );
      console.log('CORR=' + JSON.stringify(corr, null, 2));
    }
  } catch (e) {
    console.error('ERR=' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
