const EtfCorrelation = require('../models/EtfCorrelation');

exports.saveCorrelations = async (req, res, next) => {
  try {
    const { base_isin, correlations } = req.body;

    if (!base_isin) {
      return res.status(400).json({
        success: false,
        error: 'base_isin è obbligatorio'
      });
    }

    if (!Array.isArray(correlations)) {
      return res.status(400).json({
        success: false,
        error: 'correlations deve essere un array'
      });
    }

    // Allow empty correlations array (first ETF has no correlations with other ETFs)
    if (correlations.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Nessuna correlazione da salvare (primo ETF censito)',
        data: { saved: [], errors: [] }
      });
    }

    const isin1 = base_isin.trim().toUpperCase();

    const results = [];
    const errors = [];

    for (const corr of correlations) {
      const { target_isin, expansion, recession, stagflation, soft_landing } = corr;

      if (!target_isin) {
        errors.push({ target_isin: null, error: 'target_isin mancante' });
        continue;
      }

      const isin2 = target_isin.trim().toUpperCase();

      if (isin1 === isin2) {
        errors.push({ target_isin: isin2, error: 'isin1 e isin2 non possono essere uguali' });
        continue;
      }

      if (expansion == null || recession == null || stagflation == null || soft_landing == null) {
        errors.push({ target_isin: isin2, error: 'Tutti e 4 i valori macroeconomici sono obbligatori' });
        continue;
      }

      try {
        const [record, created] = await EtfCorrelation.upsert({
          isin1,
          isin2,
          expansion: parseFloat(expansion),
          recession: parseFloat(recession),
          stagflation: parseFloat(stagflation),
          soft_landing: parseFloat(soft_landing)
        }, {
          conflictFields: ['isin1', 'isin2'],
          returning: true
        });

        results.push({ target_isin: isin2, created, id: record.id });
      } catch (err) {
        errors.push({ target_isin: isin2, error: err.message });
      }
    }

    res.status(200).json({
      success: true,
      message: `Salvate ${results.length} correlazioni`,
      data: { saved: results, errors }
    });
  } catch (error) {
    next(error);
  }
};

exports.getCorrelations = async (req, res, next) => {
  try {
    const { isin1 } = req.query;

    const where = isin1 ? { isin1: isin1.trim().toUpperCase() } : {};

    const correlations = await EtfCorrelation.findAll({ where });

    res.status(200).json({
      success: true,
      data: correlations
    });
  } catch (error) {
    next(error);
  }
};
