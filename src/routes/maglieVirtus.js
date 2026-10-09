const express = require('express');
const MagliaVirtus = require('../models/MagliaVirtus');
const router = express.Router();

const ATLETI = ['Giacomo','Alessio','Lorenzo','Sonia','Asia','Paolo','Daniele','Francesca','Joshua','Sara','Sara M.','Luca','Andrea','Lillo','Cristiano'];
const TAGLIE = ['S','M','L','XL','XXL','XXXL'];

router.post('/', async (req, res, next) => {
  try {
    const { atleta, numero, taglia } = req.body || {};
    if (typeof atleta !== 'string' || !ATLETI.includes(atleta) ||
        !Number.isInteger(numero) || numero < 1 || numero > 99 ||
        typeof taglia !== 'string' || !TAGLIE.includes(taglia)) {
      return res.status(400).json({ error: 'Atleta, numero o taglia non validi' });
    }
    const record = await MagliaVirtus.create({ atleta, numero, taglia });
    return res.status(201).json({ id: record.id, atleta: record.atleta, numero: record.numero, taglia: record.taglia });
  } catch (error) { next(error); }
});

module.exports = router;
