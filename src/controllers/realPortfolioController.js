const RealPortfolio = require('../models/RealPortfolio');
const { sequelize } = require('../config/database');

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
    const description = String(req.body?.description ?? '').trim() || null;
    const portfolio = await RealPortfolio.create({ name, description, status: 'open' });
    res.status(201).json({ success: true, data: portfolio });
  } catch (error) {
    next(error);
  }
};


exports.deleteRealPortfolio = async (req, res, next) => {
  try {
    const transaction = await sequelize.transaction();
    try {
      const portfolio = await RealPortfolio.findByPk(req.params.id, { transaction });
      if (!portfolio) {
        await transaction.rollback();
        return res.status(404).json({ success: false, error: 'Portafoglio non trovato' });
      }
      // Child operations are removed by the database FK ON DELETE CASCADE.
      // Do not query the child table here: deletion must also work before any operation exists.
      await portfolio.destroy({ transaction });
      await transaction.commit();
      res.status(200).json({ success: true });
    } catch (deleteError) {
      await transaction.rollback();
      throw deleteError;
    }
  } catch (error) {
    next(error);
  }
};
