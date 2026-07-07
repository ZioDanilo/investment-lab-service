require('dotenv').config();
const { sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');

async function checkDatabase() {
  try {
    const etfs = await ETF.findAll({
      attributes: ['id', 'isin', 'name', 'description', 'ticker'],
      raw: true
    });
    
    console.log('\n=== DATABASE CONTENT ===\n');
    console.table(etfs);
    
    console.log('\n=== DETAILED VIEW ===\n');
    etfs.forEach((etf, idx) => {
      console.log(`Record ${idx + 1}:`);
      console.log(`  ISIN: ${etf.isin}`);
      console.log(`  Name: ${etf.name}`);
      console.log(`  Description: ${etf.description}`);
      console.log(`  ID: ${etf.id}`);
      console.log('');
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkDatabase();
