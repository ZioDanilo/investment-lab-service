const { sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');

async function updateETF() {
  try {
    await sequelize.authenticate();
    
    await ETF.update(
      { ticker: 'SPY' },
      { where: { isin: 'IE00B4L5Y983' } }
    );
    
    console.log('Updated EUSA to SPY ticker');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

updateETF();
