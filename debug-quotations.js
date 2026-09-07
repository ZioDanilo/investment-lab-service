const { sequelize } = require('./src/config/database');

(async () => {
  try {
    const allRecords = await sequelize.query('SELECT isin, quotation, date, "createdAt" FROM etf_quotations ORDER BY isin, "createdAt" DESC');
    console.log('All quotation records:');
    allRecords[0].forEach(row => {
      console.log('  ' + row.isin + ': €' + row.quotation + ' on ' + row.date + ' (created: ' + row.createdAt + ')');
    });
    
    console.log('\n\nCount by ISIN and DATE:');
    const countSql = 'SELECT isin, date, COUNT(*) as cnt FROM etf_quotations GROUP BY isin, date ORDER BY isin, date DESC';
    const counts = await sequelize.query(countSql);
    counts[0].forEach(row => {
      console.log('  ' + row.isin + ' on ' + row.date + ': ' + row.cnt + ' records');
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
