const ETF = require('../models/ETF');

exports.getETFs = async (req, res, next) => {
  try {
    const etfs = await ETF.find().select('-historicalData');
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
    const etf = await ETF.findById(req.params.id);
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

    const etf = new ETF({
      name,
      ticker,
      description,
      assetClass,
      expense
    });

    await etf.save();
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
    const etf = await ETF.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

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
