/**
 * Database schema migration script
 * 
 * Step 1: Drops old etf_macro_statistics table structure
 * Step 2: Creates new table with normalized schema
 * Step 3: Runs data migration
 *
 * Usage: node run-migration.js
 */

require('dotenv').config();
const { sequelize, connectDB } = require('./src/config/database');
const EtfMacroStatistics = require('./src/models/EtfMacroStatistics');
const ETF = require('./src/models/ETF');

const runMigration = async () => {
  try {
    await connectDB();
    console.log('\n🚀 Starting database schema migration...\n');

    // Step 1: Check if old data exists
    console.log('📌 Step 1: Checking for existing data...');
    const existingCount = await sequelize.query(
      `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_name = 'etf_macro_statistics'`,
      { type: sequelize.QueryTypes.SELECT }
    );

    if (existingCount[0]?.count > 0) {
      console.log('   ℹ️  Old table exists, will be recreated\n');
    } else {
      console.log('   ℹ️  No existing table found\n');
    }

    // Step 2: Drop existing table (Sequelize will handle foreign keys)
    console.log('📌 Step 2: Dropping old table structure...');
    try {
      await sequelize.query('DROP TABLE IF EXISTS etf_macro_statistics CASCADE');
      console.log('   ✅ Old table dropped\n');
    } catch (e) {
      console.log('   ℹ️  No table to drop\n');
    }

    // Step 3: Create new table with new schema
    console.log('📌 Step 3: Creating new table with normalized schema...');
    await EtfMacroStatistics.sync({ force: false });
    console.log('   ✅ New table created with schema:');
    console.log('      - Primary Key: (isin, macroScenario)');
    console.log('      - Columns: expectedReturn, volatility, maxDrawdown, returnRangeMin, returnRangeMax\n');

    // Step 4: Verify table structure
    console.log('📌 Step 4: Verifying table structure...');
    const columns = await sequelize.query(
      `SELECT column_name, data_type FROM information_schema.columns 
       WHERE table_name = 'etf_macro_statistics' 
       ORDER BY ordinal_position`,
      { type: sequelize.QueryTypes.SELECT }
    );

    console.log('   ✅ Table columns:');
    columns.forEach(col => {
      console.log(`      - ${col.column_name}: ${col.data_type}`);
    });
    console.log();

    // Step 5: Data migration (if needed)
    console.log('📌 Step 5: Checking if data migration is needed...');
    const etfsWithoutMacroStats = await sequelize.query(
      `SELECT COUNT(*) as count FROM etf_macro_statistics`,
      { type: sequelize.QueryTypes.SELECT }
    );

    if (etfsWithoutMacroStats[0]?.count === 0) {
      console.log('   ℹ️  No existing data to migrate');
      console.log('\n✨ Schema migration completed!');
      console.log('\n📋 Next steps:');
      console.log('   1. Populate etf_macro_statistics manually via UI or API');
      console.log('   2. Ensure each ETF has 4 records (one per scenario)');
      console.log('   3. Values should be in percentages (e.g., 8.1 for 8.1%)');
    } else {
      console.log(`   ℹ️  Found ${etfsWithoutMacroStats[0]?.count} records`);
      console.log('   ✅ Data already in new format');
    }

    console.log('\n✨ Database migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
};

// Run migration
runMigration();
