const Portafoglio = require('../models/Portafoglio');
const { sequelize } = require('../config/database');

const toApi = (portfolio) => {
  const p = portfolio.toJSON ? portfolio.toJSON() : portfolio;
  return {
    id: p.id,
    name: p.nome,
    description: p.descrizione,
    status: p.status,
    tipo: p.tipo,
    createdAt: p.dataCreazione,
    updatedAt: p.dataModifica
  };
};

exports.getRealPortfolios = async (req, res, next) => {
  try {
    const portfolios = await Portafoglio.findAll({
      where: { status: 'open', tipo: 'reale', userId: req.user.id },
      order: [['dataCreazione', 'ASC']]
    });
    res.status(200).json({ success: true, data: portfolios.map(toApi) });
  } catch (error) { next(error); }
};

exports.createRealPortfolio = async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'Nome portafoglio obbligatorio' });
    const description = String(req.body?.description ?? '').trim() || null;
    const existing = await Portafoglio.findAll({ where: { userId: req.user.id }, attributes: ['nome'] });
    if (existing.some((item) => String(item.nome).trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return res.status(409).json({ success: false, error: 'Nome portafoglio già utilizzato' });
    }
    const portfolio = await Portafoglio.create({
      nome: name,
      descrizione: description,
      tipo: 'reale',
      status: 'open',
      userId: req.user.id
    });
    res.status(201).json({ success: true, data: toApi(portfolio) });
  } catch (error) { next(error); }
};

exports.deleteRealPortfolio = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const portfolio = await Portafoglio.findOne({
      where: { id: req.params.id, userId: req.user.id, tipo: 'reale' },
      transaction
    });
    if (!portfolio) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });
    }
    await portfolio.destroy({ transaction });
    await transaction.commit();
    res.status(200).json({ success: true });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    next(error);
  }
};
