const { sequelize } = require('./src/config/database');

(async () => {
  try {
    const records = await sequelize.query('SELECT COUNT(*), MAX(date), MAX("createdAt") FROM etf_quotations');
    console.log('Quotations table status:');
    console.log('  Total records:', records[0][0].count);
    console.log('  Latest date:', records[0][0].max);
    console.log('  Latest created:', records[0][0].createdAt);
    
    const today = await sequelize.query("SELECT COUNT(*) as cnt FROM etf_quotations WHERE date = CURRENT_DATE");
    console.log('  Today records:', today[0][0].cnt);
    
    const recent = await sequelize.query('SELECT isin, quotation, date, "createdAt" FROM etf_quotations ORDER BY "createdAt" DESC LIMIT 5');
    console.log('\nLast 5 records:');
    recent[0].forEach(row => {
      console.log(`  ${row.isin}: €${row.quotation} on ${row.date}`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
