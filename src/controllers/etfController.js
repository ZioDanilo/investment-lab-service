const ETF = require('../models/ETF');

exports.getETFs = async (req, res, next) => {
  try {
    const etfs = await ETF.findAll();
    res.status(200).json({
      success: true,
      data: etfs
    });
  } catch (error) {
    next(error);
  }
};

exports.getETFById = async (req, res, next) => {
  try {
    const etf = await ETF.findByPk(req.params.id);
    if (!etf) {
      return res.status(404).json({
        error: 'ETF not found'
      });
    }
    res.status(200).json({
      success: true,
      data: etf
    });
  } catch (error) {
    next(error);
  }
};

exports.createETF = async (req, res, next) => {
  try {
    const { name, ticker, description, assetClass, expense } = req.body;

    const etf = await ETF.create({
      name,
      ticker,
      description,
      assetClass,
      expense
    });

    res.status(201).json({
      success: true,
      data: etf
    });
  } catch (error) {
    next(error);
  }
};

exports.updateETF = async (req, res, next) => {
  try {
    const etf = await ETF.findByPk(req.params.id);

    if (!etf) {
      return res.status(404).json({
        error: 'ETF not found'
      });
    }

    await etf.update(req.body);

    res.status(200).json({
      success: true,
      data: etf
    });
  } catch (error) {
    next(error);
  }
};

exports.addEtf = async (req, res, next) => {
  try {
    const { isin, descrizione } = req.body;

    // Validation
    if (!isin || !descrizione) {
      return res.status(400).json({
        success: false,
        error: 'ISIN e Descrizione sono obbligatori'
      });
    }

    const isinTrimmed = isin.trim().toUpperCase();
    const descrizioneTrimmed = descrizione.trim();

    // Check if ETF with this ISIN already exists
    const existingEtf = await ETF.findOne({
      where: { isin: isinTrimmed }
    });

    if (existingEtf) {
      return res.status(409).json({
        success: false,
        error: 'ETF già censito',
        data: existingEtf
      });
    }

    // Create new ETF record
    const newEtf = await ETF.create({
      isin: isinTrimmed,
      description: descrizioneTrimmed,
      name: descrizioneTrimmed,
      ticker: isinTrimmed
    });

    res.status(201).json({
      success: true,
      message: `Aggiunto ETF ${descrizioneTrimmed}`,
      data: newEtf
    });
  } catch (error) {
    next(error);
  }
};
