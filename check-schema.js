require('dotenv').config();
const { sequelize } = require('./src/config/database');

(async () => {
  try {
    await sequelize.authenticate();
    console.log('\n🔍 Checking current table structure...\n');
    
    const result = await sequelize.query(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns 
       WHERE table_name = 'etf_macro_statistics'
       ORDER BY ordinal_position`
    );
    
    console.log('📋 Columns in etf_macro_statistics:');
    if (result[0].length === 0) {
      console.log('   ❌ Table does not exist\n');
    } else {
      result[0].forEach(col => {
        console.log(`   - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
      });
      console.log();
    }
    
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
})();
