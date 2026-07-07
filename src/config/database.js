const { Sequelize, Op } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
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
    await sequelize.sync({ alter: false });
    console.log('Database models synced');
    
    return sequelize;
  } catch (error) {
    console.error('Database Connection Error:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB, Op };

