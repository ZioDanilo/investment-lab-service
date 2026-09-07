#!/usr/bin/env node

/**
 * Script to completely truncate the database (delete all data)
 * Run: node truncate-all.js
 */

require('dotenv').config();

const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

async function truncateDatabase() {
  try {
    console.log('🔗 Connecting to database...');
    await sequelize.authenticate();
    console.log('✓ Connected to PostgreSQL');

    // Import models
    const ETF = require('./src/models/ETF');
    const Portafoglio = require('./src/models/Portafoglio');
    const PortafoglioEtf = require('./src/models/PortafoglioEtf');
    const EtfCorrelation = require('./src/models/EtfCorrelation');
    const EtfMacroStatistics = require('./src/models/EtfMacroStatistics');
    const EtfQuotation = require('./src/models/EtfQuotation');

    console.log('\n🗑️  Truncating tables (order matters for FK constraints)...\n');

    // Delete in reverse order of dependencies
    let count;

    count = await PortafoglioEtf.destroy({ where: {}, truncate: false });
    console.log(`  ✓ Deleted ${count} records from portafoglio_etf`);

    count = await Portafoglio.destroy({ where: {}, truncate: false });
    console.log(`  ✓ Deleted ${count} records from portafoglio`);

    count = await EtfQuotation.destroy({ where: {}, truncate: false });
    console.log(`  ✓ Deleted ${count} records from etf_quotations`);

    count = await EtfCorrelation.destroy({ where: {}, truncate: false });
    console.log(`  ✓ Deleted ${count} records from etf_correlations`);

    count = await EtfMacroStatistics.destroy({ where: {}, truncate: false });
    console.log(`  ✓ Deleted ${count} records from etf_macro_statistics`);

    count = await ETF.destroy({ where: {}, truncate: false });
    console.log(`  ✓ Deleted ${count} records from anagrafica_etf`);

    // Reset sequences (identity)
    console.log('\n🔄 Resetting sequences...\n');
    
    const resetSequences = [
      'portafoglio_id_seq',
      'portafoglio_etf_id_seq'
    ];

    for (const seq of resetSequences) {
      try {
        await sequelize.query(`ALTER SEQUENCE IF EXISTS ${seq} RESTART WITH 1`);
        console.log(`  ✓ Reset sequence: ${seq}`);
      } catch (e) {
        console.log(`  ⚠️  Sequence not found: ${seq}`);
      }
    }

    console.log('\n✅ Database completely truncated!\n');
    
  } catch (error) {
    console.error('❌ Error truncating database:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('🔌 Connection closed\n');
  }
}

truncateDatabase();
