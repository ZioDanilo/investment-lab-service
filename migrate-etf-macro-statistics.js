/**
 * Migration script: Restructure EtfMacroStatistics table
 * 
 * Changes schema from:
 *   - 1 record per ETF with 20 columns (5 × 4 scenarios)
 * To:
 *   - 4 records per ETF (one per scenario) with 5 columns
 *
 * Usage: node migrate-etf-macro-statistics.js
 */

require('dotenv').config();
const { sequelize, connectDB } = require('./src/config/database');
const EtfMacroStatistics = require('./src/models/EtfMacroStatistics');
const ETF = require('./src/models/ETF');

const migrateData = async () => {
  try {
    await connectDB();
    console.log('\n📊 Starting EtfMacroStatistics migration...\n');

    // Step 1: Get all ETFs
    const etfs = await ETF.findAll({
      attributes: ['isin', 'name']
    });

    console.log(`📌 Found ${etfs.length} ETFs to process\n`);

    let migratedCount = 0;
    let skippedCount = 0;

    // Step 2: For each ETF, fetch old data and create 4 new records
    for (const etf of etfs) {
      try {
        // Try to fetch old data using raw query (since old columns don't exist in new schema)
        const oldData = await sequelize.query(
          `SELECT * FROM etf_macro_statistics WHERE isin = :isin`,
          {
            replacements: { isin: etf.isin },
            type: sequelize.QueryTypes.SELECT
          }
        );

        if (oldData.length === 0) {
          console.log(`⏭️  ${etf.isin} ${etf.name} - No old data found`);
          skippedCount++;
          continue;
        }

        const row = oldData[0];
        const newRecords = [
          {
            isin: etf.isin,
            macroScenario: 'expansion',
            expectedReturn: parseFloat(row.expansion_expected_return) || 0,
            volatility: parseFloat(row.expansion_volatility) || 0,
            maxDrawdown: parseFloat(row.expansion_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.expansion_return_range_min) || 0,
            returnRangeMax: parseFloat(row.expansion_return_range_max) || 0
          },
          {
            isin: etf.isin,
            macroScenario: 'soft_landing',
            expectedReturn: parseFloat(row.soft_landing_expected_return) || 0,
            volatility: parseFloat(row.soft_landing_volatility) || 0,
            maxDrawdown: parseFloat(row.soft_landing_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.soft_landing_return_range_min) || 0,
            returnRangeMax: parseFloat(row.soft_landing_return_range_max) || 0
          },
          {
            isin: etf.isin,
            macroScenario: 'recession',
            expectedReturn: parseFloat(row.recession_expected_return) || 0,
            volatility: parseFloat(row.recession_volatility) || 0,
            maxDrawdown: parseFloat(row.recession_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.recession_return_range_min) || 0,
            returnRangeMax: parseFloat(row.recession_return_range_max) || 0
          },
          {
            isin: etf.isin,
            macroScenario: 'stagflation',
            expectedReturn: parseFloat(row.stagflation_expected_return) || 0,
            volatility: parseFloat(row.stagflation_volatility) || 0,
            maxDrawdown: parseFloat(row.stagflation_max_drawdown) || 0,
            returnRangeMin: parseFloat(row.stagflation_return_range_min) || 0,
            returnRangeMax: parseFloat(row.stagflation_return_range_max) || 0
          }
        ];

        // Insert new records
        await EtfMacroStatistics.bulkCreate(newRecords, {
          ignoreDuplicates: false
        });

        console.log(`✅ ${etf.isin} ${etf.name} - Migrated 4 records (expansion, soft_landing, recession, stagflation)`);
        migratedCount++;
      } catch (error) {
        console.error(`❌ ${etf.isin} ${etf.name} - Migration failed:`, error.message);
      }
    }

    console.log(`\n📊 Migration Summary:`);
    console.log(`   ✅ Migrated: ${migratedCount} ETFs (${migratedCount * 4} total records)`);
    console.log(`   ⏭️  Skipped: ${skippedCount} ETFs`);
    console.log(`\n✨ Migration completed!\n`);

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
};

// Run migration
migrateData();
