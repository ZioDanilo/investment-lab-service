const RealPortfolio = require('../models/RealPortfolio');

exports.getRealPortfolios = async (req, res, next) => {
  try {
    const portfolios = await RealPortfolio.findAll({
      where: { status: 'active' },
      attributes: ['id', 'name', 'description', 'currency', 'createdAt', 'updatedAt'],
      order: [['createdAt', 'ASC']]
    });
    res.status(200).json({ success: true, data: portfolios });
  } catch (error) {
    next(error);
  }
};
