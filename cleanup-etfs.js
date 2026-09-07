const { sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');

async function deleteETFs() {
  try {
    await sequelize.authenticate();
    console.log('Database connected!');

    // Delete ICLN and SPY
    const result = await ETF.destroy({
      where: {
        isin: ['LU0719046485', 'IE00B4L5Y983']
      }
    });
    
    console.log(`✓ Deleted ${result} ETFs (ICLN, SPY)`);
    console.log('✓ Keeping only MVOL (IE00B8FHGS14)');

    // Verify
    const remaining = await ETF.findAll();
    console.log(`\nRemaining ETFs: ${remaining.length}`);
    remaining.forEach(etf => {
      console.log(`  - ${etf.name} (${etf.ticker})`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deleteETFs();
