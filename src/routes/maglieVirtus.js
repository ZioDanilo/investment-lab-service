const express = require('express');
const MagliaVirtus = require('../models/MagliaVirtus');
const { Op } = require('sequelize');
const router = express.Router();

const ATLETI = ['Giacomo','Alessio','Lorenzo','Sonia','Asia','Paolo','Daniele','Francesca','Joshua','Sara','Sara M.','Luca','Andrea','Lillo','Cristiano'];
const TAGLIE = ['S','M','L','XL','XXL','XXXL'];

router.get('/', async (req, res, next) => {
  try {
    const rows = await MagliaVirtus.findAll({
      attributes: ['id', 'atleta', 'numero', 'taglia'],
      order: [['atleta', 'ASC'], ['id', 'ASC']]
    });
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const { atleta, numero, taglia } = req.body || {};
    if (typeof atleta !== 'string' || !ATLETI.includes(atleta) ||
        !Number.isInteger(numero) || numero < 1 || numero > 99 ||
        typeof taglia !== 'string' || !TAGLIE.includes(taglia)) {
      return res.status(400).json({ error: 'Atleta, numero o taglia non validi' });
    }
    const existing = await MagliaVirtus.findOne({
      where: { [Op.or]: [{ atleta }, { numero }] }
    });
    if (existing) {
      return res.status(409).json({ error: 'Atleta o numero già assegnato' });
    }
    const record = await MagliaVirtus.create({ atleta, numero, taglia });
    res.status(201).json({ id: record.id, atleta: record.atleta, numero: record.numero, taglia: record.taglia });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID non valido' });
    }
    const deleted = await MagliaVirtus.destroy({ where: { id } });
    if (!deleted) return res.status(404).json({ error: 'Maglia non trovata' });
    res.status(204).send();
  } catch (error) { next(error); }
});

module.exports = router;
