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
  const RealPortfolio = require('../models/RealPortfolio');
  const RealPortfolioOperation = require('../models/RealPortfolioOperation');

  for (const [model, alias] of [[Portfolio, 'legacyPortfolios'], [Portafoglio, 'portafogli'], [RealPortfolio, 'realPortfolios']]) {
    if (!User.associations[alias]) User.hasMany(model, { foreignKey: 'userId', as: alias });
    if (!model.associations.owner) model.belongsTo(User, { foreignKey: 'userId', as: 'owner' });
  }

  if (!RealPortfolio.associations.operations) {
    RealPortfolio.hasMany(RealPortfolioOperation, {
      foreignKey: 'realPortfolioId',
      as: 'operations',
      onDelete: 'CASCADE',
      hooks: true
    });
  }

  if (!RealPortfolioOperation.associations.portfolio) {
    RealPortfolioOperation.belongsTo(RealPortfolio, {
      foreignKey: 'realPortfolioId',
      as: 'portfolio',
      onDelete: 'CASCADE'
    });
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

    // Sync models with database
    try {
      await sequelize.sync({ alter: true });
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

    return sequelize;
  } catch (error) {
    console.error('Database Connection Error:', error.message);
    return null;
  }
};

module.exports = { sequelize, connectDB, initializeAssociations, Op };

