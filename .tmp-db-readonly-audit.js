require('dotenv').config();
const { sequelize } = require('./src/config/database');

(async () => {
  try {
    const rows = await sequelize.query(
      'SELECT * FROM etf_correlations ORDER BY isin1, isin2, id',
      { type: sequelize.QueryTypes.SELECT, raw: true }
    );

    const unordered = new Map();
    for (const row of rows) {
      const key = [row.isin1, row.isin2].sort().join(':');
      if (!unordered.has(key)) unordered.set(key, []);
      unordered.get(key).push(row);
    }

    const duplicates = [...unordered.entries()].filter(([, items]) => items.length > 1);
    const totalRows = rows.length;
    const uniqueUnorderedPairs = unordered.size;
    const duplicateUnorderedPairCount = duplicates.length;
    const duplicateExtraRows = duplicates.reduce((sum, [, items]) => sum + (items.length - 1), 0);

    const newBatch = rows.filter((row) => row.createdAt && row.createdAt.toISOString ? row.createdAt.toISOString() === '2026-09-17T14:46:54.148Z' : String(row.createdAt).startsWith('2026-09-17T14:46:54.148Z'));
    const oldSuspectId = 'd6493dd5-a96b-4072-9ba1-a979dd9d3689';
    const newSuspectId = '2cde1bc4-a371-4069-ae8c-4a10e8399dfd';
    const oldSuspect = rows.find((row) => row.id === oldSuspectId);
    const newSuspect = rows.find((row) => row.id === newSuspectId);

    console.log('SUMMARY_START');
    console.log(JSON.stringify({
      total_rows: totalRows,
      unique_unordered_pairs: uniqueUnorderedPairs,
      duplicate_unordered_pair_count: duplicateUnorderedPairCount,
      duplicate_extra_rows: duplicateExtraRows,
      new_batch_rows_present: newBatch.length,
      old_suspect_present: !!oldSuspect,
      new_suspect_present: !!newSuspect
    }, null, 2));
    console.log('SUMMARY_END');

    console.log('NEW_BATCH_ROWS_START');
    console.log(JSON.stringify(newBatch.map(row => ({
      id: row.id,
      isin1: row.isin1,
      isin2: row.isin2,
      expansion: row.expansion,
      soft_landing: row.soft_landing,
      recession: row.recession,
      stagflation: row.stagflation,
      createdAt: row.createdAt
    })), null, 2));
    console.log('NEW_BATCH_ROWS_END');

    console.log('SPECIFIC_ROW_START');
    console.log(JSON.stringify({
      oldSuspect,
      newSuspect
    }, null, 2));
    console.log('SPECIFIC_ROW_END');

    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('DB_AUDIT_ERROR');
    console.error(error && error.stack || error);
    try { await sequelize.close(); } catch (_) {}
    process.exit(1);
  }
})();
