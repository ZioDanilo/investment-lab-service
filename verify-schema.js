const { sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');

(async () => {
  try {
    await ETF.update({ ticker: 'MVOL' }, { where: { isin: 'IE00B8FHGS14' } });
    console.log('Updated IE00B8FHGS14 ticker to MVOL');
    
    const etfs = await ETF.findAll({ attributes: ['isin', 'ticker', 'name'] });
    console.log('\nAll ETFs:');
    etfs.forEach(e => console.log(`  ${e.isin} - ${e.ticker} - ${e.name}`));
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
