const express = require('express');
const Giocatore = require('../models/Giocatore');
const { Op } = require('sequelize');
const router = express.Router();
const TAGLIE = ['S','M','L','XL','XXL','XXXL'];

router.get('/', async (req, res, next) => {
  try { res.json(await Giocatore.findAll({ attributes: ['id','atleta','numero','taglia','ruolo'], order: [['atleta','ASC']] })); }
  catch (e) { next(e); }
});
router.post('/', async (req, res, next) => {
  try {
    const { atleta, numero, taglia } = req.body || {};
    if (typeof atleta !== 'string' || !atleta.trim() || !Number.isInteger(numero) || numero < 1 || numero > 99 || !TAGLIE.includes(taglia))
      return res.status(400).json({ error: 'Atleta, numero o taglia non validi' });
    const row = await Giocatore.findOne({ where: { atleta: atleta.trim() } });
    if (!row) return res.status(404).json({ error: 'Giocatore non trovato' });
    if (row.numero != null) return res.status(409).json({ error: 'Maglia già assegnata a questo atleta' });
    if (await Giocatore.findOne({ where: { numero } })) return res.status(409).json({ error: 'Numero già assegnato' });
    await row.update({ numero, taglia });
    res.status(200).json(row);
  } catch (e) { next(e); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID non valido' });
    const row = await Giocatore.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Giocatore non trovato' });
    await row.update({ numero: null, taglia: null });
    res.status(204).send();
  } catch (e) { next(e); }
});
module.exports = router;
