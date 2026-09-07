const { sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');

async function seedETFs() {
  try {
    await sequelize.authenticate();
    console.log('Database connected!');

    const etfs = [
      {
        isin: 'LU0719046485',
        name: 'iShares Global Clean Energy',
        ticker: 'ICLN',
        description: 'Tracks global clean energy sector',
        assetClass: 'Equity',
        expense: 0.65
      },
      {
        isin: 'IE00B4L5Y983',
        name: 'Vanguard FTSE All-World UCITS ETF',
        ticker: 'EUSA',
        description: 'Broad world equity exposure',
        assetClass: 'Equity',
        expense: 0.22
      }
    ];

    for (const etf of etfs) {
      const [result, created] = await ETF.findOrCreate({
        where: { isin: etf.isin },
        defaults: etf
      });
      
      if (created) {
        console.log(`✓ Created: ${etf.name} (${etf.ticker})`);
      } else {
        console.log(`• Already exists: ${etf.name}`);
      }
    }

    console.log('\nETFs seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding ETFs:', error);
    process.exit(1);
  }
}

seedETFs();
