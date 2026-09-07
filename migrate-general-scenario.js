/**
 * Migration: Convert macroScenario column from ENUM to VARCHAR
 * and add 'general' value support.
 * 
 * Run once with: node migrate-general-scenario.js
 */
require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  logging: console.log,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

async function migrate() {
  try {
    await sequelize.authenticate();
    console.log('Connected to DB.');

    // Step 1: Try to add 'general' to the existing ENUM type (PostgreSQL specific)
    // The ENUM type name in Sequelize is typically: enum_<tablename>_<columnname>
    try {
      await sequelize.query(`
        ALTER TYPE "enum_etf_macro_statistics_macroScenario" ADD VALUE IF NOT EXISTS 'general';
      `);
      console.log("✓ Added 'general' to ENUM type enum_etf_macro_statistics_macroScenario");
    } catch (enumErr) {
      console.warn('Could not alter ENUM type (may not exist with that name):', enumErr.message);

      // Step 2: Fallback — convert column to VARCHAR
      console.log('Attempting to convert column to VARCHAR...');
      try {
        await sequelize.query(`
          ALTER TABLE etf_macro_statistics 
          ALTER COLUMN "macroScenario" TYPE VARCHAR(20) 
          USING "macroScenario"::VARCHAR(20);
        `);
        console.log('✓ Converted macroScenario column to VARCHAR(20)');
      } catch (varcharErr) {
        console.error('Could not convert column to VARCHAR:', varcharErr.message);

        // Step 3: Try without USING (some PostgreSQL versions)
        try {
          await sequelize.query(`
            ALTER TABLE etf_macro_statistics 
            ALTER COLUMN "macroScenario" TYPE VARCHAR(20);
          `);
          console.log('✓ Converted macroScenario column to VARCHAR(20) (without USING)');
        } catch (finalErr) {
          console.error('All migration attempts failed:', finalErr.message);
          process.exit(1);
        }
      }
    }

    // Step 3: Remove old unique index if it references ENUM type issues
    try {
      await sequelize.query(`
        DROP INDEX IF EXISTS unique_macro_stats_isin_scenario_idx;
      `);
      console.log('✓ Dropped old unique index');

      await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS unique_macro_stats_isin_scenario_idx 
        ON etf_macro_statistics (isin, "macroScenario");
      `);
      console.log('✓ Recreated unique index');
    } catch (idxErr) {
      console.warn('Index migration warning (non-fatal):', idxErr.message);
    }

    console.log('\n✅ Migration complete. Restart the server.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
