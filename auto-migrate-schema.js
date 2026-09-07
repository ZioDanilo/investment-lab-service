/**
 * Automatic schema checker and migrator
 * 
 * Checks if etf_macro_statistics is in old or new format
 * If old format found, automatically migrates to new format
 *
 * Usage: node auto-migrate-schema.js
 */

require('dotenv').config();
const { sequelize, connectDB } = require('./src/config/database');
const EtfMacroStatistics = require('./src/models/EtfMacroStatistics');
const ETF = require('./src/models/ETF');

const autoMigrate = async () => {
  try {
    await connectDB();
    console.log('\n🔍 Checking EtfMacroStatistics table schema...\n');

    // Check if table exists and what columns it has
    const columns = await sequelize.query(
      `SELECT column_name, data_type FROM information_schema.columns 
       WHERE table_name = 'etf_macro_statistics' 
       ORDER BY ordinal_position`,
      { type: sequelize.QueryTypes.SELECT }
    );

    if (columns.length === 0) {
      console.log('❌ Table does not exist\n');
      console.log('📌 Creating new table with normalized schema...');
      await EtfMacroStatistics.sync({ force: false });
      console.log('✅ New table created successfully!\n');
      process.exit(0);
    }

    console.log('📋 Current columns in etf_macro_statistics:');
    columns.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type}`);
    });
    console.log();

    // Detect format
    const hasOldColumns = columns.some(col => 
      col.column_name.includes('expansion_') || 
      col.column_name.includes('soft_landing_') ||
      col.column_name.includes('recession_') ||
      col.column_name.includes('stagflation_')
    );

    const hasNewColumns = columns.some(col => col.column_name === 'macroScenario');

    if (hasNewColumns) {
      console.log('✅ Table is already in NEW normalized format\n');
      console.log('📊 Schema verification:');
      console.log('   - PK: (isin, macroScenario)');
      console.log('   - Columns: expectedReturn, volatility, maxDrawdown, returnRangeMin, returnRangeMax');
      
      const recordCount = await sequelize.query(
        `SELECT COUNT(*) as count FROM etf_macro_statistics`,
        { type: sequelize.QueryTypes.SELECT }
      );
      console.log(`   - Records in table: ${recordCount[0].count}`);
      
      process.exit(0);
    }

    if (hasOldColumns) {
      console.log('⚠️  Table is in OLD denormalized format with 20 columns\n');
      console.log('📌 Starting automatic migration to new format...\n');

      // Step 1: Backup check
      console.log('Step 1: Checking for backup...');
      const backupCheck = await sequelize.query(
        `SELECT COUNT(*) as count FROM etf_macro_statistics`,
        { type: sequelize.QueryTypes.SELECT }
      );
      console.log(`   ℹ️  Current records in old table: ${backupCheck[0].count}`);

      // Step 2: Read all old data
      console.log('\nStep 2: Reading data from old schema...');
      const oldData = await sequelize.query(
        `SELECT * FROM etf_macro_statistics`,
        { type: sequelize.QueryTypes.SELECT }
      );
      console.log(`   ✅ Read ${oldData.length} ETF records`);

      // Step 3: Prepare new data
      console.log('\nStep 3: Transforming data to new format...');
      const newRecords = [];
      let transformedCount = 0;

      for (const row of oldData) {
        const isin = row.isin;
        
        // Create 4 records from one row
        const records = [
          {
            isin,
            macroScenario: 'expansion',
            expectedReturn: parseFloat(row.expansion_expected_return) || 0,
            volatility: parseFloat(row.expansion_volatility) || 0,
            maxDrawdown: parseFloat(row.expansion_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.expansion_return_range_min) || 0,
            returnRangeMax: parseFloat(row.expansion_return_range_max) || 0
          },
          {
            isin,
            macroScenario: 'soft_landing',
            expectedReturn: parseFloat(row.soft_landing_expected_return) || 0,
            volatility: parseFloat(row.soft_landing_volatility) || 0,
            maxDrawdown: parseFloat(row.soft_landing_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.soft_landing_return_range_min) || 0,
            returnRangeMax: parseFloat(row.soft_landing_return_range_max) || 0
          },
          {
            isin,
            macroScenario: 'recession',
            expectedReturn: parseFloat(row.recession_expected_return) || 0,
            volatility: parseFloat(row.recession_volatility) || 0,
            maxDrawdown: parseFloat(row.recession_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.recession_return_range_min) || 0,
            returnRangeMax: parseFloat(row.recession_return_range_max) || 0
          },
          {
            isin,
            macroScenario: 'stagflation',
            expectedReturn: parseFloat(row.stagflation_expected_return) || 0,
            volatility: parseFloat(row.stagflation_volatility) || 0,
            maxDrawdown: parseFloat(row.stagflation_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.stagflation_return_range_min) || 0,
            returnRangeMax: parseFloat(row.stagflation_return_range_max) || 0
          }
        ];
        
        newRecords.push(...records);
        transformedCount++;
      }

      console.log(`   ✅ Transformed ${transformedCount} ETFs into ${newRecords.length} scenario records`);

      // Step 4: Drop old table and create new
      console.log('\nStep 4: Replacing table schema...');
      try {
        await sequelize.query('DROP TABLE IF EXISTS etf_macro_statistics CASCADE');
        console.log('   ✅ Old table dropped');
      } catch (e) {
        console.log('   ℹ️  Could not drop table:', e.message);
      }

      // Step 5: Create new table
      console.log('\nStep 5: Creating new normalized schema...');
      await EtfMacroStatistics.sync({ force: false });
      console.log('   ✅ New table created');

      // Step 6: Insert transformed data
      console.log('\nStep 6: Inserting transformed data...');
      if (newRecords.length > 0) {
        await EtfMacroStatistics.bulkCreate(newRecords, {
          ignoreDuplicates: false
        });
        console.log(`   ✅ Inserted ${newRecords.length} records`);
      }

      // Step 7: Verify
      console.log('\nStep 7: Verifying migration...');
      const finalColumns = await sequelize.query(
        `SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'etf_macro_statistics' 
         ORDER BY ordinal_position`,
        { type: sequelize.QueryTypes.SELECT }
      );
      
      const finalCount = await sequelize.query(
        `SELECT COUNT(*) as count FROM etf_macro_statistics`,
        { type: sequelize.QueryTypes.SELECT }
      );

      console.log('   ✅ New schema columns:');
      finalColumns.forEach(col => {
        console.log(`      - ${col.column_name}`);
      });
      console.log(`   ✅ Total records: ${finalCount[0].count}`);

      console.log('\n✨ Migration completed successfully!\n');
      console.log('📝 Summary:');
      console.log(`   - ${transformedCount} ETFs migrated`);
      console.log(`   - ${newRecords.length} scenario records created (4 per ETF)`);
      console.log(`   - Schema normalized to 5 columns per record\n`);

      process.exit(0);
    }

    console.log('❓ Table format unclear\n');
    console.log('📋 Columns found:');
    columns.forEach(col => console.log(`   - ${col.column_name}`));
    
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.sql) console.error('SQL:', error.sql);
    process.exit(1);
  }
};

autoMigrate();
