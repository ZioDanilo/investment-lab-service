# Database Schema Restructuring: EtfMacroStatistics

## 📋 Summary

The `etf_macro_statistics` table has been restructured from a **denormalized** format to a **normalized** format.

## 🔄 Schema Changes

### BEFORE (Denormalized - 1 record per ETF, 20 columns)

```
Table: etf_macro_statistics

Columns:
- id (UUID, PK)
- isin (VARCHAR, unique)
- expansion_expected_return
- expansion_volatility
- expansion_max_drawdown
- expansion_return_range_min
- expansion_return_range_max
- soft_landing_expected_return
- soft_landing_volatility
- soft_landing_max_drawdown
- soft_landing_return_range_min
- soft_landing_return_range_max
- recession_expected_return
- recession_volatility
- recession_max_drawdown
- recession_return_range_min
- recession_return_range_max
- stagflation_expected_return
- stagflation_volatility
- stagflation_max_drawdown
- stagflation_return_range_min
- stagflation_return_range_max
```

**Example data:**
```
| id    | isin           | expansion_exp_return | soft_landing_exp_return | recession_exp_return | stagflation_exp_return |
|-------|----------------|----------------------|------------------------|----------------------|------------------------|
| uuid1 | IE00B4L5Y983   | 8.1                  | 6.5                    | -4.5                 | -2.3                   |
```

### AFTER (Normalized - 4 records per ETF, 5 columns + FK)

```
Table: etf_macro_statistics

Columns:
- isin (VARCHAR, FK)
- macroScenario (ENUM, PK)  ← NEW
- expectedReturn (DECIMAL)
- volatility (DECIMAL)
- maxDrawdown (DECIMAL)
- returnRangeMin (DECIMAL)
- returnRangeMax (DECIMAL)
- createdAt
- updatedAt

Primary Key: (isin, macroScenario)
```

**Example data:**
```
| isin           | macroScenario | expectedReturn | volatility | maxDrawdown | returnRangeMin | returnRangeMax |
|----------------|---------------|----------------|------------|-------------|----------------|----------------|
| IE00B4L5Y983   | expansion     | 8.1            | 12.3       | -18.5       | -8.2           | 21.5           |
| IE00B4L5Y983   | soft_landing  | 6.5            | 10.8       | -15.2       | -7.1           | 18.3           |
| IE00B4L5Y983   | recession     | -4.5           | 16.2       | -28.1       | -23.4          | 9.2            |
| IE00B4L5Y983   | stagflation   | -2.3           | 14.8       | -25.0       | -20.1          | 10.5           |
```

## 🔑 Key Changes

| Aspect | Before | After |
|--------|--------|-------|
| **Records per ETF** | 1 | 4 |
| **Scenario info** | Column prefix (expansion_*) | Row value (macroScenario enum) |
| **Metric columns** | 20 | 5 |
| **Primary Key** | UUID | Composite (isin, macroScenario) |
| **Foreign Key** | isin (UNIQUE) | isin (with foreign key constraint) |
| **Row duplication** | None | Essential (4 records per ETF) |
| **Query efficiency** | SELECT all fields | SELECT by scenario |

## ✅ Benefits

1. **Normalizes data** - One fact per cell, follows 3NF
2. **Easier querying** - `WHERE macroScenario = 'expansion'` instead of prefixed columns
3. **Scalability** - Easy to add new scenarios without schema change
4. **Code clarity** - Frontend code treats all scenarios uniformly
5. **Indexing** - Composite index on (isin, macroScenario) is efficient
6. **Reduced data redundancy** - Column names don't repeat

## 🚀 Migration Steps

### Step 1: Backup current database
```bash
# Remote PostgreSQL on Clever Cloud - create backup in admin panel
# Local: pg_dump -U postgres portfolio_db > backup_$(date +%Y%m%d).sql
```

### Step 2: Run schema migration
```bash
cd investment-lab-service
node run-migration.js
```

Output:
```
📌 Step 1: Checking for existing data...
📌 Step 2: Dropping old table structure...
   ✅ Old table dropped

📌 Step 3: Creating new table with normalized schema...
   ✅ New table created with schema:
      - Primary Key: (isin, macroScenario)
      - Columns: expectedReturn, volatility, maxDrawdown, returnRangeMin, returnRangeMax

📌 Step 4: Verifying table structure...
   ✅ Table columns:
      - isin: character varying
      - macroScenario: enum
      - expectedReturn: numeric
      - volatility: numeric
      - maxDrawdown: numeric
      - returnRangeMin: numeric
      - returnRangeMax: numeric
      - createdAt: timestamp
      - updatedAt: timestamp
```

### Step 3: Populate with data
If migrating from old data:
```bash
node migrate-etf-macro-statistics.js
```

If starting fresh:
- Use the UI Control Panel to add macro statistics
- Or populate via API endpoints

### Step 4: Restart backend
```bash
npm run dev
```

### Step 5: Verify frontend
- Start frontend: `npm start`
- Load a portfolio
- Check browser console for no warnings
- Run simulation - should work normally

## 🔧 Code Changes

### Backend Controllers
**File**: `src/controllers/portafoglioController.js`

**Changed:**
- `formatMacroStatistics()` now accepts **array** of 4 records instead of single record
- Reads `macroScenario` enum to determine which scenario
- Maps scenario name: `soft_landing` → `softLanding` for frontend consistency
- Converts percentages to decimals: `/100` for all numeric fields

**Before:**
```javascript
const formatMacroStatistics = (ms) => ({
  expansion: { expectedReturn: parseFloat(ms.expansion_expected_return) / 100, ... },
  softLanding: { expectedReturn: parseFloat(ms.soft_landing_expected_return) / 100, ... },
  ...
});
```

**After:**
```javascript
const formatMacroStatistics = (msArray) => {
  const result = {};
  for (const ms of msArray) {
    const scenarioKey = ms.macroScenario === 'soft_landing' ? 'softLanding' : ms.macroScenario;
    result[scenarioKey] = {
      expectedReturn: parseFloat(ms.expectedReturn) / 100,
      volatility: parseFloat(ms.volatility) / 100,
      ...
    };
  }
  return result;
};
```

### Sequelize Models
**File**: `src/models/EtfMacroStatistics.js`

**Changed:**
- Removed UUID `id` primary key
- Added composite primary key: `(isin, macroScenario)`
- Changed 20 columns to 5 simple columns
- Added `ENUM` constraint on `macroScenario`: ['expansion', 'soft_landing', 'recession', 'stagflation']
- Updated indexes

### Associations
**File**: `src/server.js`

**Changed:**
- `ETF.hasOne()` → `ETF.hasMany()` (one ETF has many MacroStatistics)

```javascript
// BEFORE
ETF.hasOne(EtfMacroStatistics, { foreignKey: 'isin', sourceKey: 'isin', as: 'macroStats' });

// AFTER
ETF.hasMany(EtfMacroStatistics, { foreignKey: 'isin', sourceKey: 'isin', as: 'macroStats' });
```

### Frontend (No changes needed!)
**File**: `src/app/core/services/portfolio-state.service.ts`

- Already expects `macroStatistics` to be an object with keys: expansion, softLanding, recession, stagflation
- Backend now composes this from 4 records transparently
- No changes required in frontend code

## 🔍 Verification Checklist

After migration:
- [ ] Backend starts without errors
- [ ] Database tables created correctly
- [ ] No foreign key constraint errors
- [ ] Portfolio loading returns data with macroStatistics
- [ ] Monte Carlo simulation runs without warnings
- [ ] No "expectedReturn looks like percentage?" warnings in browser console
- [ ] Decimal values are correct (0.081 not 8.1)

## 💾 Rollback

If issues occur:
```bash
# Restore from backup
psql -U postgres < backup_$(date +%Y%m%d).sql

# Or manually revert schema in code and restart
git checkout src/models/EtfMacroStatistics.js
git checkout src/server.js
npm run dev
```

## 📊 Query Examples

### Get all scenarios for one ETF
```sql
SELECT * FROM etf_macro_statistics 
WHERE isin = 'IE00B4L5Y983'
ORDER BY macroScenario;
```

### Get expansion scenario stats
```sql
SELECT isin, expectedReturn, volatility, maxDrawdown 
FROM etf_macro_statistics 
WHERE macroScenario = 'expansion' 
AND expectedReturn BETWEEN 0 AND 20;
```

### Find ETFs by volatility range (recession)
```sql
SELECT DISTINCT isin 
FROM etf_macro_statistics 
WHERE macroScenario = 'recession' 
AND volatility < 15;
```

## 📝 Notes

- All numeric values are stored in **percentages** in database (e.g., 8.1 for 8.1%)
- Frontend receives **decimals** (e.g., 0.081 for 8.1%) after division by 100 in backend
- No changes to Monte Carlo engine - it already expects decimal values
- This restructuring makes the database schema match 3NF normalization
