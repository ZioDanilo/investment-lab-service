// Eseguire UNA volta prima del deploy del nuovo backend: node scripts/migrate-giocatori.js
require('dotenv').config();
const { sequelize } = require('../src/config/database');
const NAMES = ['Alessio','Andrea','Asia','Cristiano','Daniele','Francesca','Giacomo','Joshua','Lillo','Lorenzo','Luca','Martina','Michela','Paolo','Sara D.','Sara M.','Sonia','Vale'];
(async () => {
  try {
    await sequelize.transaction(async transaction => {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS giocatori (
        id SERIAL PRIMARY KEY, atleta VARCHAR(100) NOT NULL UNIQUE,
        numero INTEGER UNIQUE CHECK (numero BETWEEN 1 AND 99),
        taglia VARCHAR(5), ruolo VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`, { transaction });
      for (const atleta of NAMES) {
        await sequelize.query('INSERT INTO giocatori (atleta) VALUES (:atleta) ON CONFLICT (atleta) DO NOTHING', { replacements: { atleta }, transaction });
      }
      const [tables] = await sequelize.query("SELECT to_regclass('public.maglie_virtus') AS old_table", { transaction });
      if (tables[0].old_table) {
        const [missing] = await sequelize.query('SELECT m.atleta FROM maglie_virtus m LEFT JOIN giocatori g ON g.atleta = m.atleta WHERE g.id IS NULL', { transaction });
        if (missing.length) throw new Error('Atleti non migrati: ' + missing.map(x => x.atleta).join(', '));
        const [duplicates] = await sequelize.query('SELECT numero FROM maglie_virtus GROUP BY numero HAVING COUNT(*) > 1', { transaction });
        if (duplicates.length) throw new Error('Numeri duplicati nella tabella sorgente');
        await sequelize.query(`UPDATE giocatori g SET numero = m.numero, taglia = m.taglia, updated_at = NOW()
          FROM maglie_virtus m WHERE g.atleta = m.atleta`, { transaction });
        const [[oldCount], [newCount]] = await Promise.all([
          sequelize.query('SELECT COUNT(*)::int AS n FROM maglie_virtus', { transaction }),
          sequelize.query('SELECT COUNT(*)::int AS n FROM giocatori WHERE numero IS NOT NULL', { transaction })
        ]);
        if (oldCount[0].n !== newCount[0].n) throw new Error('Conteggi non corrispondenti; rollback');
        await sequelize.query('DROP TABLE maglie_virtus', { transaction });
      }
      const [rows] = await sequelize.query('SELECT atleta, numero, taglia, ruolo FROM giocatori ORDER BY atleta', { transaction });
      if (rows.length !== NAMES.length) throw new Error('Attesi 18 giocatori, trovati ' + rows.length);
      console.log('Migrazione completata:', rows.length, 'giocatori');
    });
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { await sequelize.close(); }
})();
