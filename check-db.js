require('dotenv').config();
const { sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');

async function checkDatabase() {
  try {
    // Get count
    const count = await ETF.count();
    console.log(`Total ETF records: ${count}`);
    
    // Get all records with selected attributes
    const etfs = await sequelize.query(
      'SELECT isin, name, description FROM anagrafica_etf LIMIT 10',
      { type: sequelize.QueryTypes.SELECT }
    );
    
    console.log('\n=== ETF DATA ===\n');
    console.table(etfs);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkDatabase();
