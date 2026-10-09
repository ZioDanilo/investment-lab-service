// Inizializza la tabella giocatori senza dipendenze da tabelle precedenti.
// Esecuzione: node scripts/migrate-giocatori.js
require('dotenv').config();
const { sequelize } = require('../src/config/database');
const Giocatore = require('../src/models/Giocatore');
const ATLETI = ['Alessio','Andrea','Asia','Cristiano','Daniele','Francesca','Giacomo','Joshua','Lillo','Lorenzo','Luca','Martina','Michela','Paolo','Sara D.','Sara M.','Sonia','Vale'];

(async () => {
  try {
    await sequelize.authenticate();
    await Giocatore.sync();
    await sequelize.transaction(async transaction => {
      for (const atleta of ATLETI) {
        await Giocatore.findOrCreate({
          where: { atleta },
          defaults: { numero: null, taglia: null, ruolo: null },
          transaction
        });
      }
    });
    const count = await Giocatore.count();
    console.log('Tabella giocatori pronta. Record totali:', count);
  } catch (error) {
    console.error('Inizializzazione giocatori fallita:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
