const Portfolio = require('../models/Portfolio');

exports.getPortfolios = async (req, res, next) => {
  try {
    const portfolios = await Portfolio.find({ status: 'active' });
    res.status(200).json({
      success: true,
      data: portfolios
    });
  } catch (error) {
    next(error);
  }
};

exports.getPortfolioById = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio) {
      return res.status(404).json({
        error: 'Portfolio not found'
      });
    }
    res.status(200).json({
      success: true,
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

exports.createPortfolio = async (req, res, next) => {
  try {
    const { name, description, holdings } = req.body;

    const portfolio = new Portfolio({
      name,
      description,
      holdings
    });

    await portfolio.save();
    res.status(201).json({
      success: true,
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

exports.updatePortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!portfolio) {
      return res.status(404).json({
        error: 'Portfolio not found'
      });
    }

    res.status(200).json({
      success: true,
      data: portfolio
    });
  } catch (error) {
    next(error);
  }
};

exports.deletePortfolio = async (req, res, next) => {
  try {
    const portfolio = await Portfolio.findByIdAndUpdate(
      req.params.id,
      { status: 'archived' },
      { new: true }
    );

    if (!portfolio) {
      return res.status(404).json({
        error: 'Portfolio not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Portfolio archived'
    });
  } catch (error) {
    next(error);
  }
};
