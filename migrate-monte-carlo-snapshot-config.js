/**
 * Creates the persistent macro configuration required by the Monte Carlo
 * Snapshot API and seeds the default values expected by the validation layer.
 *
 * Usage: node migrate-monte-carlo-snapshot-config.js
 */
require('dotenv').config();

const { sequelize } = require('./src/config/database');
const { DataTypes } = require('sequelize');
const ScenarioInertiaConfiguration = require('./src/models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = require('./src/models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = require('./src/models/MonteCarloGlobalProperty');

const INERTIA_DEFAULTS = [
  { scenario: 'expansion', entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 },
  { scenario: 'recession', entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 },
  { scenario: 'stagflation', entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 },
  { scenario: 'soft_landing', entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 }
];

const INTENSITY_DEFAULTS = [
  { scenario: 'expansion', meanIntensity: 0.50, stdDevIntensity: 0.10 },
  { scenario: 'recession', meanIntensity: 0.50, stdDevIntensity: 0.10 },
  { scenario: 'stagflation', meanIntensity: 0.50, stdDevIntensity: 0.10 },
  { scenario: 'soft_landing', meanIntensity: 0.50, stdDevIntensity: 0.10 }
];

const GLOBAL_PROPERTY_DEFAULTS = [
  { propertyKey: 'scenario_transition_intensity_threshold', value: 0.60 },
  { propertyKey: 'new_scenario_first_month_max_intensity', value: 0.40 },
  { propertyKey: 'new_scenario_second_month_max_intensity', value: 0.70 },
  { propertyKey: 'scenario_intensity_max_monthly_variation', value: 0.40 }
];

const migrate = async () => {
  try {
    await sequelize.authenticate();
    await ScenarioInertiaConfiguration.sync();
    await ScenarioIntensityConfiguration.sync();
    await MonteCarloGlobalProperty.sync();
    await sequelize.getQueryInterface().changeColumn('etf_macro_statistics', 'maxDrawdown', {
      type: DataTypes.DECIMAL(7, 4),
      allowNull: true
    });

    await ScenarioInertiaConfiguration.bulkCreate(INERTIA_DEFAULTS, { updateOnDuplicate: ['entryProbability', 'persistenceProbability', 'entryMonths', 'exitStartMonth', 'exitDecay'] });
    await ScenarioIntensityConfiguration.bulkCreate(INTENSITY_DEFAULTS, { updateOnDuplicate: ['meanIntensity', 'stdDevIntensity'] });
    await MonteCarloGlobalProperty.bulkCreate(GLOBAL_PROPERTY_DEFAULTS, { updateOnDuplicate: ['value'] });

    console.log('Monte Carlo snapshot configuration schema and defaults are ready.');
  } finally {
    await sequelize.close();
  }
};

migrate().catch((error) => {
  console.error('Monte Carlo snapshot configuration migration failed:', error.message);
  process.exitCode = 1;
});