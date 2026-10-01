require('dotenv').config();
const { connectDB } = require('./src/config/database');
const Factor = require('./src/models/Factor');
const catalog = require('./src/data/factor-catalog-v1');

(async () => {
  await connectDB();
  for (const factor of catalog) {
    await Factor.upsert(factor);
  }
  console.log('Factor catalog V1 seeded:', catalog.length);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
