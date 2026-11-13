const express = require('express');
const Giocatore = require('../models/Giocatore');
const { Op } = require('sequelize');
const router = express.Router();
const TAGLIE = ['S','M','L','XL','XXL'];

router.get('/', async (req, res, next) => {
  try { res.json(await Giocatore.findAll({ attributes: ['id','atleta','numero','taglia','nickname','ruolo','pantaloncini'], order: [['atleta','ASC']] })); }
  catch (e) { next(e); }
});
router.post('/', async (req, res, next) => {
  try {
    const { atleta, numero, taglia, nickname } = req.body || {};
    if (typeof atleta !== 'string' || !atleta.trim() || !Number.isInteger(numero) || numero < 1 || numero > 99 || !TAGLIE.includes(taglia) || typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 100)
      return res.status(400).json({ error: 'Atleta, numero, taglia o nickname non validi' });
    const row = await Giocatore.findOne({ where: { atleta: atleta.trim() } });
    if (!row) return res.status(404).json({ error: 'Giocatore non trovato' });
    if (row.numero != null) return res.status(409).json({ error: 'Maglia già assegnata a questo atleta' });
    if (await Giocatore.findOne({ where: { numero } })) return res.status(409).json({ error: 'Numero già assegnato' });
    await row.update({ numero, taglia, nickname: nickname.trim() });
    res.status(200).json(row);
  } catch (e) { next(e); }
});
router.patch('/:id/pantaloncini', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { pantaloncini } = req.body || {};
    if (!Number.isSafeInteger(id) || id <= 0 || !TAGLIE.includes(pantaloncini))
      return res.status(400).json({ error: 'ID o taglia pantaloncini non validi' });
    const row = await Giocatore.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Giocatore non trovato' });
    if (row.numero == null) return res.status(409).json({ error: 'Nessuna maglia assegnata' });
    if (row.pantaloncini != null) return res.status(409).json({ error: 'Taglia pantaloncini già assegnata' });
    await row.update({ pantaloncini });
    res.json(row);
  } catch (e) { next(e); }
});
router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'ID non valido' });
    const row = await Giocatore.findByPk(id);
    if (!row) return res.status(404).json({ error: 'Giocatore non trovato' });
    await row.update({ numero: null, taglia: null, nickname: null, pantaloncini: null });
    res.status(204).send();
  } catch (e) { next(e); }
});
module.exports = router;
