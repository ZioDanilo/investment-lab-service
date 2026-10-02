const { Sequelize, Op } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 15000,
    evict: 10000
  },
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    },
    statement_timeout: 30000,
    idle_in_transaction_session_timeout: 30000
  },
  retry: {
    max: 3,
    backoffBase: 500,
    backoffExponent: 1.5
  }
});

const initializeAssociations = () => {
  const User = require('../models/User');
  const Portfolio = require('../models/Portfolio');
  const ETF = require('../models/ETF');
  const Portafoglio = require('../models/Portafoglio');
  const PortafoglioEtf = require('../models/PortafoglioEtf');
  const EtfMacroStatistics = require('../models/EtfMacroStatistics');
  const MarketUniverseRun = require('../models/MarketUniverseRun');
  const MarketUniverseMonth = require('../models/MarketUniverseMonth');
  const MarketUniverseBinaryChunk = require('../models/MarketUniverseBinaryChunk');
  const RealPortfolioOperation = require('../models/RealPortfolioOperation');
  const RealPortfolioEtf = require('../models/RealPortfolioEtf');
  const RealPortfolioOrder = require('../models/RealPortfolioOrder');
  const Factor = require('../models/Factor');
  const FactorScenarioStatistic = require('../models/FactorScenarioStatistic');
  const FactorCorrelation = require('../models/FactorCorrelation');
  const EtfFactorExposure = require('../models/EtfFactorExposure');
  const EtfSpecificRisk = require('../models/EtfSpecificRisk');
  const EtfModelFit = require('../models/EtfModelFit');
  const InvestmentIndex = require('../models/InvestmentIndex');

  if (!InvestmentIndex.associations.etfs) InvestmentIndex.hasMany(ETF, { foreignKey: 'indexId', as: 'etfs' });
  if (!ETF.associations.underlyingIndex) ETF.belongsTo(InvestmentIndex, { foreignKey: 'indexId', as: 'underlyingIndex' });

  if (!Factor.associations.children) Factor.hasMany(Factor, { foreignKey: 'parentFactorId', as: 'children' });
  if (!Factor.associations.parent) Factor.belongsTo(Factor, { foreignKey: 'parentFactorId', as: 'parent' });
  if (!Factor.associations.scenarioStatistics) Factor.hasMany(FactorScenarioStatistic, { foreignKey: 'factorId', as: 'scenarioStatistics', onDelete: 'CASCADE' });
  if (!FactorScenarioStatistic.associations.factor) FactorScenarioStatistic.belongsTo(Factor, { foreignKey: 'factorId', as: 'factor' });
  if (!Factor.associations.exposures) Factor.hasMany(EtfFactorExposure, { foreignKey: 'factorId', as: 'exposures', onDelete: 'CASCADE' });
  if (!EtfFactorExposure.associations.factor) EtfFactorExposure.belongsTo(Factor, { foreignKey: 'factorId', as: 'factor' });
  if (!ETF.associations.factorExposures) ETF.hasMany(EtfFactorExposure, { foreignKey: 'etfId', as: 'factorExposures', onDelete: 'CASCADE' });
  if (!EtfFactorExposure.associations.etf) EtfFactorExposure.belongsTo(ETF, { foreignKey: 'etfId', as: 'etf' });
  if (!ETF.associations.specificRisk) ETF.hasOne(EtfSpecificRisk, { foreignKey: 'etfId', as: 'specificRisk', onDelete: 'CASCADE' });
  if (!EtfSpecificRisk.associations.etf) EtfSpecificRisk.belongsTo(ETF, { foreignKey: 'etfId', as: 'etf' });
  if (!ETF.associations.modelFits) ETF.hasMany(EtfModelFit, { foreignKey: 'etfId', as: 'modelFits', onDelete: 'CASCADE' });
  if (!EtfModelFit.associations.etf) EtfModelFit.belongsTo(ETF, { foreignKey: 'etfId', as: 'etf' });
  if (!Factor.associations.correlationsAsFirst) Factor.hasMany(FactorCorrelation, { foreignKey: 'factor1Id', as: 'correlationsAsFirst', onDelete: 'CASCADE' });
  if (!Factor.associations.correlationsAsSecond) Factor.hasMany(FactorCorrelation, { foreignKey: 'factor2Id', as: 'correlationsAsSecond', onDelete: 'CASCADE' });
  if (!FactorCorrelation.associations.factor1) FactorCorrelation.belongsTo(Factor, { foreignKey: 'factor1Id', as: 'factor1' });
  if (!FactorCorrelation.associations.factor2) FactorCorrelation.belongsTo(Factor, { foreignKey: 'factor2Id', as: 'factor2' });

  for (const [model, alias] of [[Portfolio, 'legacyPortfolios'], [Portafoglio, 'portafogli']]) {
    if (!User.associations[alias]) User.hasMany(model, { foreignKey: 'userId', as: alias });
    if (!model.associations.owner) model.belongsTo(User, { foreignKey: 'userId', as: 'owner' });
  }

  if (!Portafoglio.associations.realOrder) Portafoglio.hasOne(RealPortfolioOrder, { foreignKey: 'realPortfolioId', as: 'realOrder', onDelete: 'CASCADE' });
  if (!RealPortfolioOrder.associations.portfolio) RealPortfolioOrder.belongsTo(Portafoglio, { foreignKey: 'realPortfolioId', as: 'portfolio', onDelete: 'CASCADE' });
  if (!User.associations.realPortfolioOrders) User.hasMany(RealPortfolioOrder, { foreignKey: 'userId', as: 'realPortfolioOrders', onDelete: 'CASCADE' });
  if (!RealPortfolioOrder.associations.user) RealPortfolioOrder.belongsTo(User, { foreignKey: 'userId', as: 'user', onDelete: 'CASCADE' });

  if (!Portafoglio.associations.operations) {
    Portafoglio.hasMany(RealPortfolioOperation, {
      foreignKey: 'realPortfolioId',
      as: 'operations',
      onDelete: 'CASCADE',
      hooks: true
    });
  }

  if (!RealPortfolioOperation.associations.portfolio) {
    RealPortfolioOperation.belongsTo(Portafoglio, {
      foreignKey: 'realPortfolioId',
      as: 'portfolio',
      onDelete: 'CASCADE'
    });
  }

  if (!User.associations.realPortfolioOperations) {
    User.hasMany(RealPortfolioOperation, { foreignKey: 'userId', as: 'realPortfolioOperations', onDelete: 'CASCADE' });
  }
  if (!RealPortfolioOperation.associations.user) {
    RealPortfolioOperation.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  }
  if (!Portafoglio.associations.realEtfs) {
    Portafoglio.hasMany(RealPortfolioEtf, { foreignKey: 'realPortfolioId', as: 'realEtfs', onDelete: 'CASCADE' });
  }
  if (!RealPortfolioEtf.associations.portfolio) {
    RealPortfolioEtf.belongsTo(Portafoglio, { foreignKey: 'realPortfolioId', as: 'portfolio', onDelete: 'CASCADE' });
  }
  if (!ETF.associations.realPortfolioEtfs) {
    ETF.hasMany(RealPortfolioEtf, { foreignKey: 'etfId', as: 'realPortfolioEtfs' });
  }
  if (!RealPortfolioEtf.associations.etf) {
    RealPortfolioEtf.belongsTo(ETF, { foreignKey: 'etfId', as: 'etf' });
  }

  if (!ETF.associations.realPortfolioOperations) {
    ETF.hasMany(RealPortfolioOperation, { foreignKey: 'etfId', as: 'realPortfolioOperations' });
  }
  if (!RealPortfolioOperation.associations.etf) {
    RealPortfolioOperation.belongsTo(ETF, { foreignKey: 'etfId', as: 'etf' });
  }

  if (!Portafoglio.associations.etfs) {
    Portafoglio.hasMany(PortafoglioEtf, {
      foreignKey: 'portafoglioId',
      as: 'etfs',
      onDelete: 'CASCADE'
    });
  }

  if (!PortafoglioEtf.associations.portafoglio) {
    PortafoglioEtf.belongsTo(Portafoglio, {
      foreignKey: 'portafoglioId'
    });
  }

  if (!PortafoglioEtf.associations.etf) {
    PortafoglioEtf.belongsTo(ETF, {
      foreignKey: 'etfId',
      as: 'etf'
    });
  }

  if (!ETF.associations.portafoglioEtfs) {
    ETF.hasMany(PortafoglioEtf, {
      foreignKey: 'etfId'
    });
  }

  if (!ETF.associations.macroStats) {
    ETF.hasMany(EtfMacroStatistics, {
      foreignKey: 'isin',
      sourceKey: 'isin',
      as: 'macroStats'
    });
  }

  if (!EtfMacroStatistics.associations.etf) {
    EtfMacroStatistics.belongsTo(ETF, {
      foreignKey: 'isin',
      targetKey: 'isin'
    });
  }

  if (!MarketUniverseRun.associations.months) {
    MarketUniverseRun.hasMany(MarketUniverseMonth, {
      foreignKey: 'runId',
      as: 'months',
      onDelete: 'CASCADE'
    });
  }

  if (!MarketUniverseMonth.associations.marketUniverseRun) {
    MarketUniverseMonth.belongsTo(MarketUniverseRun, {
      foreignKey: 'runId',
      targetKey: 'runId'
    });
  }

  if (!MarketUniverseRun.associations.binaryChunks) {
    MarketUniverseRun.hasMany(MarketUniverseBinaryChunk, {
      foreignKey: 'runId',
      as: 'binaryChunks',
      onDelete: 'CASCADE'
    });
  }

  if (!MarketUniverseBinaryChunk.associations.marketUniverseRun) {
    MarketUniverseBinaryChunk.belongsTo(MarketUniverseRun, {
      foreignKey: 'runId',
      targetKey: 'runId'
    });
  }
};

const connectDB = async () => {
  try {
    initializeAssociations();
    await sequelize.authenticate();
    console.log('PostgreSQL Connected:', process.env.DATABASE_URL.split('@')[1]);

    // Import models
    const EtfCorrelation = require('../models/EtfCorrelation');
    const EtfQuotation = require('../models/EtfQuotation');
    const StructuralProbability = require('../models/StructuralProbability');
    const TransitionMatrix = require('../models/TransitionMatrix');
    const ScenarioInertiaConfiguration = require('../models/ScenarioInertiaConfiguration');
    const ScenarioIntensityConfiguration = require('../models/ScenarioIntensityConfiguration');
    const MonteCarloGlobalProperty = require('../models/MonteCarloGlobalProperty');

    // One-time/idempotent unification: real_portfolios -> portafogli.
    // Preserve UUIDs so existing operations continue to reference the same portfolio.
    try {
      await sequelize.query(`
        ALTER TABLE portafogli ADD COLUMN IF NOT EXISTS tipo VARCHAR(32) NOT NULL DEFAULT 'laboratorio';
        ALTER TABLE portafogli ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'open';
        UPDATE portafogli SET tipo = 'laboratorio' WHERE tipo IS NULL OR tipo = '';
        UPDATE portafogli SET status = 'open' WHERE status IS NULL OR status = '';

        INSERT INTO portafogli (id, user_id, nome, descrizione, tipo, status, "dataCreazione", "dataModifica")
        SELECT id, user_id, name, description, 'reale', status::text, created_at, updated_at
          FROM real_portfolios rp
         WHERE NOT EXISTS (SELECT 1 FROM portafogli p WHERE p.id = rp.id);

        ALTER TABLE real_portfolio_operations DROP CONSTRAINT IF EXISTS real_portfolio_operations_real_portfolio_id_fkey;
        ALTER TABLE real_portfolio_operations
          ADD CONSTRAINT real_portfolio_operations_real_portfolio_id_fkey
          FOREIGN KEY (real_portfolio_id) REFERENCES portafogli(id) ON DELETE CASCADE;
        DROP TABLE IF EXISTS real_portfolios;
      `);
      console.log('Unified portfolio migration applied');
    } catch (migrationError) {
      console.warn('Unified portfolio migration warning:', migrationError.message);
    }

    // Factor Engine V2 models must be explicitly loaded before sequelize.sync().
    // Requiring them only inside initializeAssociations is not sufficient because
    // that function is intentionally idempotent and the V2 schema must always be
    // registered when the server starts.
    const Factor = require('../models/Factor');
    const FactorScenarioStatistic = require('../models/FactorScenarioStatistic');
    const FactorCorrelation = require('../models/FactorCorrelation');
    const InvestmentIndex = require('../models/InvestmentIndex');
    const EtfFactorExposure = require('../models/EtfFactorExposure');
    const EtfSpecificRisk = require('../models/EtfSpecificRisk');
    const EtfModelFit = require('../models/EtfModelFit');

    // Sync models with database
    try {
      await sequelize.sync();
      console.log('Database models synced');
    } catch (syncError) {
      console.warn('Database sync warning (non-fatal):', syncError.message);
      console.warn('Server continues with existing schema. Run manual migration if needed.');
    }

    void EtfCorrelation;
    void EtfQuotation;
    void StructuralProbability;
    void TransitionMatrix;
    void ScenarioInertiaConfiguration;
    void ScenarioIntensityConfiguration;
    void MonteCarloGlobalProperty;
    void Factor;
    void FactorScenarioStatistic;
    void FactorCorrelation;
    void InvestmentIndex;
    void EtfFactorExposure;
    void EtfSpecificRisk;
    void EtfModelFit;

    return sequelize;
  } catch (error) {
    console.error('Database Connection Error:', error.message);
    return null;
  }
};

module.exports = { sequelize, connectDB, initializeAssociations, Op };

