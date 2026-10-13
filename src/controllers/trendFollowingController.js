const Portafoglio = require('../models/Portafoglio');
const PortfolioTrendStrategy = require('../models/PortfolioTrendStrategy');

const STRATEGIES = [
  'buy-hold-momentum', 'sma-200', 'ts-momentum-12m',
  'dual-sma-50-200', 'momentum-world-xeon', 'momentum-xeon-fast-reentry',
  'trend-vol-target', 'momentum-world-xeon-vol-target'
];

async function getOwnedPortfolio(req, res) {
  const portfolio = await Portafoglio.findOne({
    where: { id: req.params.portfolioId, userId: req.user.id, tipo: 'reale', status: 'open' }
  });
  if (!portfolio) res.status(404).json({ success: false, error: 'Portafoglio reale non trovato' });
  return portfolio;
}

exports.getEtfs = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    const { sequelize } = require('../config/database');
    const [rows] = await sequelize.query(`
      SELECT e.isin, e.name, e.nickname, e.ticker
      FROM public.real_portfolio_etf r
      JOIN public.anagrafica_etf e ON e.id = r.etf_id
      WHERE r.real_portfolio_id = :portfolioId AND r.quantity > 0
      ORDER BY COALESCE(NULLIF(e.nickname, ''), e.name, e.isin)
    `, { replacements: { portfolioId: req.params.portfolioId } });
    res.json({ success: true, data: rows });
  } catch (error) { next(error); }
};

exports.get = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    const row = await PortfolioTrendStrategy.findOne({ where: { portfolioId: req.params.portfolioId, userId: req.user.id } });
    res.json({ success: true, data: row ? { portfolioId: row.portfolioId, strategyKey: row.strategyKey, settings: row.settings } : null });
  } catch (error) { next(error); }
};

exports.put = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    const { strategyKey, settings } = req.body ?? {};
    if (!STRATEGIES.includes(strategyKey) || !settings || Array.isArray(settings) || typeof settings !== 'object') {
      return res.status(400).json({ success: false, error: 'Strategia o impostazioni non valide' });
    }
    let cleanSettings = {};
    if (Object.prototype.hasOwnProperty.call(settings, 'etfIsins')) {
      if (!Array.isArray(settings.etfIsins) || settings.etfIsins.length !== 3) {
        return res.status(400).json({ success: false, error: 'Servono tre slot ETF, anche vuoti' });
      }
      const etfIsins = settings.etfIsins.map(value => typeof value === 'string' ? value.trim().toUpperCase() : null);
      if (etfIsins.some(value => value === null || (value && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(value)))) {
        return res.status(400).json({ success: false, error: 'ISIN non valido' });
      }
      const nonEmpty = etfIsins.filter(Boolean);
      if (new Set(nonEmpty).size !== nonEmpty.length) {
        return res.status(400).json({ success: false, error: 'ETF duplicato nei tre slot' });
      }
      // Only ETFs held by the selected real portfolio can be assigned to a slot.
      if (nonEmpty.length) {
        const { sequelize } = require('../config/database');
        const [held] = await sequelize.query(
          `SELECT DISTINCT e.isin
           FROM public.real_portfolio_etf r
           JOIN public.anagrafica_etf e ON e.id = r.etf_id
           WHERE r.real_portfolio_id = :portfolioId AND r.quantity > 0 AND e.isin IN (:isins)`,
          { replacements: { portfolioId: req.params.portfolioId, isins: nonEmpty } }
        );
        const allowed = new Set(held.map(row => String(row.isin).toUpperCase()));
        if (nonEmpty.some(isin => !allowed.has(isin))) {
          return res.status(400).json({ success: false, error: 'ETF non presente nel portafoglio reale' });
        }
      }
      cleanSettings = { etfIsins };
    } else if (strategyKey === 'sma-200') {
      return res.status(400).json({ success: false, error: 'Slot SMA200 mancanti' });
    } else {
      cleanSettings = settings;
    }
    const [row] = await PortfolioTrendStrategy.findOrCreate({
      where: { portfolioId: req.params.portfolioId },
      defaults: { portfolioId: req.params.portfolioId, userId: req.user.id, strategyKey, settings: cleanSettings }
    });
    await row.update({ strategyKey, settings: cleanSettings, userId: req.user.id });
    res.json({ success: true, data: { portfolioId: row.portfolioId, strategyKey: row.strategyKey, settings: row.settings } });
  } catch (error) { next(error); }
};

exports.getEtfSelections = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    if (!STRATEGIES.includes(req.params.strategyKey)) return res.status(400).json({ success: false, error: 'Strategia non valida' });
    const { sequelize } = require('../config/database');
    const [rows] = await sequelize.query(
      'SELECT slot_index, isin FROM public.portfolio_trend_etf_selections WHERE portfolio_id = :portfolioId AND strategy_key = :strategyKey ORDER BY slot_index',
      { replacements: { portfolioId: req.params.portfolioId, strategyKey: req.params.strategyKey } }
    );
    const etfIsins = ['', '', ''];
    for (const row of rows) etfIsins[Number(row.slot_index)] = row.isin;
    res.json({ success: true, data: { etfIsins } });
  } catch (error) { next(error); }
};

exports.putEtfSelections = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    const strategyKey = req.params.strategyKey;
    const etfIsins = req.body?.etfIsins;
    if (!STRATEGIES.includes(strategyKey) || !Array.isArray(etfIsins) || etfIsins.length !== 3 ||
      etfIsins.some(isin => typeof isin !== 'string' || (isin && !/^[A-Z]{2}[A-Z0-9]{10}$/.test(isin)))) {
      return res.status(400).json({ success: false, error: 'Selezioni ETF non valide' });
    }
    const chosen = etfIsins.filter(Boolean);
    if (new Set(chosen).size !== chosen.length) return res.status(400).json({ success: false, error: 'ETF duplicati' });
    const { sequelize } = require('../config/database');
    if (chosen.length) {
      const [rows] = await sequelize.query(
        'SELECT DISTINCT e.isin FROM public.real_portfolio_etf r JOIN public.anagrafica_etf e ON e.id = r.etf_id WHERE r.real_portfolio_id = :portfolioId AND r.quantity > 0 AND e.isin IN (:isins)',
        { replacements: { portfolioId: req.params.portfolioId, isins: chosen } }
      );
      if (rows.length !== chosen.length) return res.status(400).json({ success: false, error: 'ETF non presente nel portafoglio' });
    }
    await sequelize.transaction(async transaction => {
      await sequelize.query('DELETE FROM public.portfolio_trend_etf_selections WHERE portfolio_id = :portfolioId AND strategy_key = :strategyKey',
        { replacements: { portfolioId: req.params.portfolioId, strategyKey }, transaction });
      for (let i = 0; i < etfIsins.length; i++) {
        if (!etfIsins[i]) continue;
        await sequelize.query(
          'INSERT INTO public.portfolio_trend_etf_selections (portfolio_id, strategy_key, slot_index, isin) VALUES (:portfolioId, :strategyKey, :slotIndex, :isin)',
          { replacements: { portfolioId: req.params.portfolioId, strategyKey, slotIndex: i, isin: etfIsins[i] }, transaction }
        );
      }
    });
    res.json({ success: true, data: { etfIsins } });
  } catch (error) { next(error); }
};
