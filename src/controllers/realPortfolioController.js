const Portafoglio = require('../models/Portafoglio');
const RealPortfolioOperation = require('../models/RealPortfolioOperation');
const RealPortfolioEtf = require('../models/RealPortfolioEtf');
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
    updatedAt: p.dataModifica,
    virtualCash: Number(p.virtualCash ?? 0),
    contributedCapital: Number(p.contributedCapital ?? 0)
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
      transaction,
      lock: transaction.LOCK.UPDATE
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
  const transaction = await sequelize.transaction();
  try {
    const portfolio = await Portafoglio.findOne({
      where: { id: req.params.id, userId: req.user.id, tipo: 'reale', status: 'open' },
      transaction
    });
    if (!portfolio) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });
    }

    const operationType = String(req.body?.operationType ?? '');
    const etfId = String(req.body?.etfId ?? '');
    const operationDate = String(req.body?.operationDate ?? '');
    const quantity = Number(req.body?.quantity);
    const unitPrice = Number(req.body?.unitPrice);

    if (!['buy', 'sell'].includes(operationType)) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'Tipo operazione non valido' });
    }
    if (!etfId || !operationDate || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'ETF, data, quantità e valore unitario sono obbligatori e devono essere validi' });
    }

    const etf = await ETF.findByPk(etfId, { transaction });
    if (!etf) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'ETF non trovato' });
    }

    let position = await RealPortfolioEtf.findOne({
      where: { realPortfolioId: portfolio.id, etfId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const currentQuantity = Number(position?.quantity ?? 0);
    const nextQuantity = operationType === 'buy' ? currentQuantity + quantity : currentQuantity - quantity;

    if (nextQuantity < 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: 'Quantità da vendere superiore alla posizione disponibile' });
    }

    const operation = await RealPortfolioOperation.create({
      userId: req.user.id, realPortfolioId: portfolio.id, operationType, etfId, operationDate, quantity, unitPrice
    }, { transaction });

    if (position) {
      if (nextQuantity === 0) await position.destroy({ transaction });
      else await position.update({ quantity: nextQuantity }, { transaction });
    } else {
      if (operationType !== 'buy') {
        await transaction.rollback();
        return res.status(400).json({ success: false, error: 'ETF non presente nel portafoglio' });
      }
      position = await RealPortfolioEtf.create({ realPortfolioId: portfolio.id, etfId, quantity: nextQuantity }, { transaction });
    }

    const operationValue = quantity * unitPrice;
    const currentVirtualCash = Number(portfolio.virtualCash ?? 0);
    const currentContributedCapital = Number(portfolio.contributedCapital ?? 0);
    let nextVirtualCash = currentVirtualCash;
    let nextContributedCapital = currentContributedCapital;

    if (operationType === 'sell') {
      nextVirtualCash = currentVirtualCash + operationValue;
    } else {
      const cashUsed = Math.min(currentVirtualCash, operationValue);
      nextVirtualCash = currentVirtualCash - cashUsed;
      nextContributedCapital = currentContributedCapital + (operationValue - cashUsed);
    }

    await portfolio.update({
      virtualCash: nextVirtualCash,
      contributedCapital: nextContributedCapital,
      dataModifica: new Date()
    }, { transaction });

    await transaction.commit();
    res.status(201).json({
      success: true,
      data: {
        id: operation.id, portfolioId: operation.realPortfolioId, operationType: operation.operationType,
        etf: { id: etf.id, isin: etf.isin, ticker: etf.ticker, name: etf.name, nickname: etf.nickname },
        operationDate: operation.operationDate, quantity: operation.quantity, unitPrice: operation.unitPrice,
        portfolioQuantity: nextQuantity,
        virtualCash: nextVirtualCash,
        contributedCapital: nextContributedCapital
      }
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    next(error);
  }
};

exports.getHoldings = async (req, res, next) => {
  try {
    const portfolio = await Portafoglio.findOne({
      where: { id: req.params.id, userId: req.user.id, tipo: 'reale', status: 'open' }
    });
    if (!portfolio) return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });

    const holdings = await RealPortfolioEtf.findAll({
      where: { realPortfolioId: portfolio.id },
      include: [{ model: ETF, as: 'etf', attributes: ['id', 'isin', 'ticker', 'name', 'nickname'] }],
      order: [['etfId', 'ASC']]
    });
    res.status(200).json({ success: true, data: holdings.map((row) => ({
      id: row.etf.id, isin: row.etf.isin, ticker: row.etf.ticker, name: row.etf.name,
      nickname: row.etf.nickname, quantity: row.quantity
    })) });
  } catch (error) { next(error); }
};


exports.getOperations = async (req, res, next) => {
  try {
    const portfolio = await Portafoglio.findOne({ where: { id: req.params.id, userId: req.user.id, tipo: 'reale' } });
    if (!portfolio) return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });
    const operations = await RealPortfolioOperation.findAll({
      where: { userId: req.user.id, realPortfolioId: portfolio.id },
      include: [{ model: ETF, as: 'etf', attributes: ['id', 'isin', 'ticker', 'name', 'nickname'] }],
      order: [['operationDate', 'DESC'], ['createdAt', 'DESC']]
    });
    res.status(200).json({ success: true, data: operations.map((o) => ({
      id: o.id, operationType: o.operationType, operationDate: o.operationDate,
      quantity: o.quantity, unitPrice: o.unitPrice,
      total: Number(o.quantity) * Number(o.unitPrice),
      etf: o.etf
    })) });
  } catch (error) { next(error); }
};


exports.getLatestOperations = async (req, res, next) => {
  try {
    const portfolio = await Portafoglio.findOne({
      where: { id: req.params.id, userId: req.user.id, tipo: 'reale' }
    });
    if (!portfolio) return res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });

    const operations = await RealPortfolioOperation.findAll({
      where: { userId: req.user.id, realPortfolioId: portfolio.id },
      include: [{ model: ETF, as: 'etf', attributes: ['id', 'isin', 'ticker', 'name', 'nickname'] }],
      order: [['operationDate', 'DESC'], ['createdAt', 'DESC']],
      limit: 5
    });

    res.status(200).json({ success: true, data: operations.map((o) => ({
      id: o.id,
      operationType: o.operationType,
      operationDate: o.operationDate,
      quantity: o.quantity,
      unitPrice: o.unitPrice,
      total: Number(o.quantity) * Number(o.unitPrice),
      etf: o.etf
    })) });
  } catch (error) { next(error); }
};
