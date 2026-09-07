require('dotenv').config();
const { sequelize } = require('./src/config/database');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('\n✅ Connected to database\n');
    
    // Check table records (use quoted column names for case sensitivity)
    const result = await sequelize.query(
      `SELECT isin, "macroScenario", "expectedReturn", volatility, "maxDrawdown"
       FROM etf_macro_statistics
       LIMIT 10`
    );
    
    const count = await sequelize.query(
      `SELECT COUNT(*) as count FROM etf_macro_statistics`
    );
    
    console.log('📊 Table Status:');
    console.log(`   Total records: ${count[0][0].count}`);
    
    if (count[0][0].count === 0) {
      console.log('   ⚠️  Table is EMPTY - no data found\n');
      console.log('📋 Next steps:');
      console.log('   1. Populate via UI Control Panel');
      console.log('   2. Or run: node seed-etf-macro-stats.js\n');
    } else {
      console.log(`   ✅ Sample data (first 10 records):\n`);
      
      console.log('   ISIN               | Scenario      | ExpReturn | Volatility');
      console.log('   ' + '-'.repeat(65));
      
      result[0].forEach(row => {
        const isin = row.isin.padEnd(18);
        const scenario = row.macroScenario.padEnd(13);
        const expRet = String(row.expectedReturn).padStart(9);
        const vol = String(row.volatility).padStart(10);
        console.log(`   ${isin} | ${scenario} | ${expRet} | ${vol}`);
      });
      console.log();
    }
    
    console.log('✨ Schema verification complete\n');
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();
