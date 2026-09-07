/**
 * Seed script for Monte Carlo configuration tables.
 * Populates all tables required by the snapshot validation contract.
 *
 * Usage: node seed-monte-carlo.js
 */

require('dotenv').config();
const StructuralProbability = require('./src/models/StructuralProbability');
const TransitionMatrix = require('./src/models/TransitionMatrix');
const ScenarioInertiaConfiguration = require('./src/models/ScenarioInertiaConfiguration');
const ScenarioIntensityConfiguration = require('./src/models/ScenarioIntensityConfiguration');
const MonteCarloGlobalProperty = require('./src/models/MonteCarloGlobalProperty');
const { connectDB } = require('./src/config/database');

const DEFAULT_STRUCTURAL_PROBABILITIES = {
  expansion: 0.55,
  recession: 0.15,
  stagflation: 0.10,
  soft_landing: 0.20
};

const DEFAULT_TRANSITION_MATRIX = {
  expansion: { expansion: 0.60, recession: 0.10, stagflation: 0.10, soft_landing: 0.20 },
  recession: { expansion: 0.25, recession: 0.20, stagflation: 0.05, soft_landing: 0.50 },
  stagflation: { expansion: 0.20, recession: 0.20, stagflation: 0.30, soft_landing: 0.30 },
  soft_landing: { expansion: 0.40, recession: 0.20, stagflation: 0.10, soft_landing: 0.30 }
};

const DEFAULT_INERTIA = {
  expansion: { entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 },
  recession: { entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 },
  stagflation: { entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 },
  soft_landing: { entryProbability: 0.60, persistenceProbability: 0.70, entryMonths: 2, exitStartMonth: 3, exitDecay: 0.10 }
};

const DEFAULT_INTENSITY = {
  expansion: { meanIntensity: 0.50, stdDevIntensity: 0.10 },
  recession: { meanIntensity: 0.50, stdDevIntensity: 0.10 },
  stagflation: { meanIntensity: 0.50, stdDevIntensity: 0.10 },
  soft_landing: { meanIntensity: 0.50, stdDevIntensity: 0.10 }
};

const DEFAULT_GLOBAL_PROPERTIES = {
  scenario_transition_intensity_threshold: 0.60,
  new_scenario_first_month_max_intensity: 0.40,
  new_scenario_second_month_max_intensity: 0.70,
  scenario_intensity_max_monthly_variation: 0.40
};

const seedMonteCarloConfig = async () => {
  try {
    await connectDB();
    console.log('\n📊 Seeding Monte Carlo Configuration...\n');

    console.log('🗑️  Clearing existing Monte Carlo configuration data...');
    await StructuralProbability.destroy({ where: {} });
    await TransitionMatrix.destroy({ where: {} });
    await ScenarioInertiaConfiguration.destroy({ where: {} });
    await ScenarioIntensityConfiguration.destroy({ where: {} });
    await MonteCarloGlobalProperty.destroy({ where: {} });

    console.log('📌 Seeding structural probabilities...');
    const structuralData = Object.entries(DEFAULT_STRUCTURAL_PROBABILITIES).map(([scenario, probability]) => ({
      scenario,
      probability,
      description: `Initial probability for ${scenario}`
    }));
    await StructuralProbability.bulkCreate(structuralData);
    console.log(`   ✅ Created ${structuralData.length} structural probability records`);

    console.log('📌 Seeding transition matrix...');
    const transitionData = [];
    for (const [fromScenario, toScenarios] of Object.entries(DEFAULT_TRANSITION_MATRIX)) {
      for (const [toScenario, probability] of Object.entries(toScenarios)) {
        transitionData.push({
          fromScenario,
          toScenario,
          probability,
          description: `Transition from ${fromScenario} to ${toScenario}`
        });
      }
    }
    await TransitionMatrix.bulkCreate(transitionData);
    console.log(`   ✅ Created ${transitionData.length} transition matrix records`);

    console.log('📌 Seeding inertia configuration...');
    const inertiaData = Object.entries(DEFAULT_INERTIA).map(([scenario, config]) => ({
      scenario,
      entryProbability: config.entryProbability,
      persistenceProbability: config.persistenceProbability,
      entryMonths: config.entryMonths,
      exitStartMonth: config.exitStartMonth,
      exitDecay: config.exitDecay
    }));
    await ScenarioInertiaConfiguration.bulkCreate(inertiaData);
    console.log(`   ✅ Created ${inertiaData.length} inertia configuration records`);

    console.log('📌 Seeding intensity configuration...');
    const intensityData = Object.entries(DEFAULT_INTENSITY).map(([scenario, config]) => ({
      scenario,
      meanIntensity: config.meanIntensity,
      stdDevIntensity: config.stdDevIntensity
    }));
    await ScenarioIntensityConfiguration.bulkCreate(intensityData);
    console.log(`   ✅ Created ${intensityData.length} intensity configuration records`);

    console.log('📌 Seeding global properties...');
    const globalPropertyData = Object.entries(DEFAULT_GLOBAL_PROPERTIES).map(([propertyKey, value]) => ({
      propertyKey,
      value
    }));
    await MonteCarloGlobalProperty.bulkCreate(globalPropertyData);
    console.log(`   ✅ Created ${globalPropertyData.length} global properties`);

    console.log('\n✓ Verifying transition matrix row sums...');
    for (const [fromScenario, toScenarios] of Object.entries(DEFAULT_TRANSITION_MATRIX)) {
      const sum = Object.values(toScenarios).reduce((a, b) => a + b, 0);
      const checkmark = Math.abs(sum - 1.0) < 0.001 ? '✅' : '⚠️';
      console.log(`   ${checkmark} ${fromScenario}: ${sum.toFixed(6)}`);
    }

    console.log('\n✨ Monte Carlo configuration seeded successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error.message);
    process.exit(1);
  }
};

seedMonteCarloConfig();
