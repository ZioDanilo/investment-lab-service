require('dotenv').config();
const { sequelize } = require('./src/config/database');

async function repairDatabase() {
  try {
    // Connect without models first
    await sequelize.authenticate();
    console.log('Connected to database');

    // Fix anagrafica_etf table if needed - add PRIMARY KEY
    try {
      await sequelize.query(`ALTER TABLE anagrafica_etf ADD PRIMARY KEY (id);`);
      console.log('Added PRIMARY KEY to anagrafica_etf');
    } catch (e) {
      console.log('PRIMARY KEY already exists on anagrafica_etf');
    }

    // Drop and recreate portafoglio tables
    await sequelize.query('DROP TABLE IF EXISTS portafoglio_etf CASCADE;');
    await sequelize.query('DROP TABLE IF EXISTS portafogli CASCADE;');
    console.log('Dropped old portafoglio tables');

    // Sync fresh models
    const ETF = require('./src/models/ETF');
    const Portafoglio = require('./src/models/Portafoglio');
    const PortafoglioEtf = require('./src/models/PortafoglioEtf');

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

    // Sync models
    await sequelize.sync({ force: false, alter: false });
    console.log('Database repaired and synced ✓');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

repairDatabase();
