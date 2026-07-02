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
