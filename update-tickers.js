const { sequelize } = require('./src/config/database');
const ETF = require('./src/models/ETF');

(async () => {
  await sequelize.authenticate();
  
  const updates = [
    { isin: 'LU0719046485', ticker: 'ICLN' },
    { isin: 'IE00B8FHGS14', ticker: 'EUWV' },
    { isin: 'IE00B4L5Y983', ticker: 'EUSA' }
  ];
  
  for (const { isin, ticker } of updates) {
    await ETF.update({ ticker }, { where: { isin } });
    console.log(`Updated ${isin} with ticker ${ticker}`);
  }
  
  console.log('All tickers updated successfully');
  process.exit(0);
})().catch(err => { 
  console.error(err); 
  process.exit(1); 
});
