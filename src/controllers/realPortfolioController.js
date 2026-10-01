const Portafoglio = require('../models/Portafoglio');
const RealPortfolioOperation = require('../models/RealPortfolioOperation');
const ETF = require('../models/ETF');
const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

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
      order: [['dataCreazione', 'DESC']]
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


exports.createOperation = async (req, res, next) => {
  try {
    const portfolio = await Portafoglio.findOne({
      where: { id: req.params.id, userId: req.user.id, tipo: 'reale', status: 'open' }
    });
    if (!portfolio) return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });

    const operationType = String(req.body?.operationType ?? '');
    const etfId = String(req.body?.etfId ?? '');
    const operationDate = String(req.body?.operationDate ?? '');
    const quantity = Number(req.body?.quantity);
    const unitPrice = Number(req.body?.unitPrice);

    if (!['buy', 'sell'].includes(operationType)) {
      return res.status(400).json({ success: false, error: 'Tipo operazione non valido' });
    }
    if (!etfId || !operationDate || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      return res.status(400).json({ success: false, error: 'ETF, data, quantità e valore unitario sono obbligatori e devono essere validi' });
    }

    const etf = await ETF.findByPk(etfId);
    if (!etf) return res.status(404).json({ success: false, error: 'ETF non trovato' });

    if (operationType === 'sell') {
      const [position] = await sequelize.query(`
        SELECT COALESCE(SUM(CASE WHEN operation_type = 'buy' THEN quantity ELSE -quantity END), 0) AS quantity
        FROM real_portfolio_operations
        WHERE user_id = :userId AND real_portfolio_id = :portfolioId AND etf_id = :etfId
      `, { replacements: { userId: req.user.id, portfolioId: portfolio.id, etfId }, type: QueryTypes.SELECT });
      if (Number(position?.quantity ?? 0) < quantity) {
        return res.status(400).json({ success: false, error: 'Quantità da vendere superiore alla posizione disponibile' });
      }
    }

    const operation = await RealPortfolioOperation.create({
      userId: req.user.id,
      realPortfolioId: portfolio.id,
      operationType,
      etfId,
      operationDate,
      quantity,
      unitPrice
    });

    res.status(201).json({
      success: true,
      data: {
        id: operation.id,
        portfolioId: operation.realPortfolioId,
        operationType: operation.operationType,
        etf: { id: etf.id, isin: etf.isin, ticker: etf.ticker, name: etf.name, nickname: etf.nickname },
        operationDate: operation.operationDate,
        quantity: operation.quantity,
        unitPrice: operation.unitPrice
      }
    });
  } catch (error) { next(error); }
};


exports.getHoldings = async (req, res, next) => {
  try {
    const portfolio = await Portafoglio.findOne({
      where: { id: req.params.id, userId: req.user.id, tipo: 'reale', status: 'open' }
    });
    if (!portfolio) return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });

    const holdings = await sequelize.query(`
      SELECT e.id, e.isin, e.ticker, e.name, e.nickname,
             SUM(CASE WHEN o.operation_type = 'buy' THEN o.quantity ELSE -o.quantity END) AS quantity
        FROM real_portfolio_operations o
        JOIN anagrafica_etf e ON e.id = o.etf_id
       WHERE o.user_id = :userId AND o.real_portfolio_id = :portfolioId
       GROUP BY e.id, e.isin, e.ticker, e.name, e.nickname
      HAVING SUM(CASE WHEN o.operation_type = 'buy' THEN o.quantity ELSE -o.quantity END) > 0
       ORDER BY COALESCE(e.nickname, e.ticker, e.name), e.isin
    `, { replacements: { userId: req.user.id, portfolioId: portfolio.id }, type: QueryTypes.SELECT });

    res.status(200).json({ success: true, data: holdings });
  } catch (error) { next(error); }
};
