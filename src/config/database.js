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

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('PostgreSQL Connected:', process.env.DATABASE_URL.split('@')[1]);

    // Import models
    const ETF = require('../models/ETF');
    const Portafoglio = require('../models/Portafoglio');
    const PortafoglioEtf = require('../models/PortafoglioEtf');
    const EtfCorrelation = require('../models/EtfCorrelation');
    const EtfMacroStatistics = require('../models/EtfMacroStatistics');
    const EtfQuotation = require('../models/EtfQuotation');
    const StructuralProbability = require('../models/StructuralProbability');
    const TransitionMatrix = require('../models/TransitionMatrix');
    const ScenarioInertiaConfiguration = require('../models/ScenarioInertiaConfiguration');
    const ScenarioIntensityConfiguration = require('../models/ScenarioIntensityConfiguration');
    const MonteCarloGlobalProperty = require('../models/MonteCarloGlobalProperty');

    // Define associations
    Portafoglio.hasMany(PortafoglioEtf, {
      foreignKey: 'portafoglioId',
      as: 'etfs',
      onDelete: 'CASCADE'
    });
    PortafoglioEtf.belongsTo(Portafoglio, {
      foreignKey: 'portafoglioId'
    });

    PortafoglioEtf.belongsTo(ETF, {
      foreignKey: 'etfId',
      as: 'etf'
    });
    ETF.hasMany(PortafoglioEtf, {
      foreignKey: 'etfId'
    });

    // Sync models with database
    try {
      await sequelize.sync({ alter: true });
      console.log('Database models synced');
    } catch (syncError) {
      console.warn('Database sync warning (non-fatal):', syncError.message);
      console.warn('Server continues with existing schema. Run manual migration if needed.');
    }

    void ScenarioInertiaConfiguration;
    void ScenarioIntensityConfiguration;
    void MonteCarloGlobalProperty;

    return sequelize;
  } catch (error) {
    console.error('Database Connection Error:', error.message);
    return null;
  }
};

module.exports = { sequelize, connectDB, Op };

