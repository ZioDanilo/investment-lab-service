const RealPortfolio = require('../models/RealPortfolio');

exports.getRealPortfolios = async (req, res, next) => {
  try {
    const portfolios = await RealPortfolio.findAll({
      where: { status: 'open' },
      attributes: ['id', 'name', 'description', 'status', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'ASC']]
    });
    res.status(200).json({ success: true, data: portfolios });
  } catch (error) {
    next(error);
  }
};


exports.createRealPortfolio = async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Nome portafoglio obbligatorio' });
    const portfolio = await RealPortfolio.create({ name, description: null, status: 'open' });
    res.status(201).json({ success: true, data: portfolio });
  } catch (error) {
    next(error);
  }
};
