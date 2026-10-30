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

const CRITERION_KEYS = [
  'sma-200', 'ts-momentum-12m', 'dual-sma-50-200',
  'momentum-world-xeon', 'momentum-xeon-fast-reentry',
  'trend-volatility-targeting', 'momentum-world-xeon-volatility-targeting'
];
const normalizeCriterion = (row) => ({
  strategyKey: String(row?.strategyKey || ''),
  isin: String(row?.isin || '').trim().toUpperCase(),
  benchmarkIsin: String(row?.benchmarkIsin || '').trim().toUpperCase(),
  thirdIsin: String(row?.thirdIsin || '').trim().toUpperCase(),
  signal: row?.signal === 'buy' ? 'buy' : 'sell',
  enabled: row?.enabled !== false,
  thresholdPercent: ['sma-200','dual-sma-50-200'].includes(row?.strategyKey) ? Number(row?.thresholdPercent ?? 0) : 0
});

const normalizeSignalEnabled = settings => ({
  sell: settings?.signalEnabled?.sell !== false,
  buy: settings?.signalEnabled?.buy !== false
});

exports.putSignalEnabled = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    const { signal, enabled } = req.body ?? {};
    if (!['sell', 'buy'].includes(signal) || typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Stato segnale non valido' });
    }
    const portfolioId = req.params.portfolioId;
    const { sequelize } = require('../config/database');
    await PortfolioTrendStrategy.findOrCreate({
      where: { portfolioId, userId: req.user.id },
      defaults: { portfolioId, userId: req.user.id, strategyKey: 'sma-200', settings: {} }
    });
    // Update only the requested flag atomically, preserving criteria and other settings.
    const [rows] = await sequelize.query(`
      UPDATE public.portfolio_trend_strategies
      SET settings = jsonb_set(settings, '{signalEnabled}', COALESCE(settings->'signalEnabled', '{}'::jsonb) || jsonb_build_object(:signal, CAST(:enabled AS jsonb)), true),
          updated_at = NOW()
      WHERE portfolio_id = :portfolioId AND user_id = :userId
      RETURNING settings
    `, { replacements: { portfolioId, userId: req.user.id, signal, enabled: JSON.stringify(enabled) } });
    return res.json({ success: true, data: { signalEnabled: normalizeSignalEnabled(rows[0]?.settings) } });
  } catch (error) { next(error); }
};

exports.getCriteria = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    const { sequelize } = require('../config/database');
    const portfolioId = req.params.portfolioId;
    const saved = await PortfolioTrendStrategy.findOne({ where: { portfolioId, userId: req.user.id } });
    if (Array.isArray(saved?.settings?.criteria)) {
      return res.json({ success: true, data: { criteria: saved.settings.criteria, signalEnabled: normalizeSignalEnabled(saved.settings) } });
    }
    // Non-destructive legacy migration: recover all three historical strategy slots.
    const [legacy] = await sequelize.query(
      'SELECT strategy_key, slot_index, isin FROM public.portfolio_trend_etf_selections WHERE portfolio_id = :portfolioId ORDER BY strategy_key, slot_index',
      { replacements: { portfolioId } }
    );
    const criteria = legacy
      .filter(row => CRITERION_KEYS.includes(row.strategy_key))
      .map(row => ({ strategyKey: row.strategy_key, isin: String(row.isin).toUpperCase(), benchmarkIsin: '' }));
    // Also recover legacy SMA settings when selections table was not populated.
    if (!criteria.length && saved?.strategyKey === 'sma-200' && Array.isArray(saved.settings?.etfIsins)) {
      for (const isin of saved.settings.etfIsins.filter(Boolean)) criteria.push({ strategyKey: 'sma-200', isin, benchmarkIsin: '' });
    }
    return res.json({ success: true, data: { criteria, signalEnabled: normalizeSignalEnabled(saved?.settings), migratedFromLegacy: true } });
  } catch (error) { next(error); }
};

exports.putCriteria = async (req, res, next) => {
  try {
    if (!await getOwnedPortfolio(req, res)) return;
    const portfolioId = req.params.portfolioId;
    const input = req.body?.criteria;
    if (!Array.isArray(input) || input.length > 100 || input.some(row => !row || !['', ...CRITERION_KEYS].includes(row.strategyKey) || (row.signal != null && !['buy','sell'].includes(row.signal)))) {
      return res.status(400).json({ success: false, error: 'Elenco criteri non valido' });
    }
    const criteria = input.map(normalizeCriterion);
    if (input.some(row => row.enabled != null && typeof row.enabled !== 'boolean')) return res.status(400).json({ success: false, error: 'Stato attivazione strategia non valido' });
    if (criteria.some(row => !Number.isFinite(row.thresholdPercent) || row.thresholdPercent < -100 || row.thresholdPercent > 100 || (row.signal === 'sell' && row.thresholdPercent > 0) || (row.signal === 'buy' && row.thresholdPercent < 0))) {
      return res.status(400).json({ success: false, error: 'Soglia non valida: vendita <= 0%, acquisto >= 0%, valore numerico' });
    }
    if (criteria.some(row => !row.strategyKey)) {
      return res.status(400).json({ success: false, error: 'Non salvare criteri senza strategia selezionata' });
    }
    const validIsin = value => !value || /^[A-Z]{2}[A-Z0-9]{10}$/.test(value);
    if (criteria.some(row => !validIsin(row.isin) || !validIsin(row.benchmarkIsin) || !validIsin(row.thirdIsin))) {
      return res.status(400).json({ success: false, error: 'ISIN non valido' });
    }
    if(criteria.some(row => row.strategyKey === 'momentum-world-xeon' && (!row.isin || !row.benchmarkIsin)))return res.status(400).json({success:false,error:'A 3 Stati richiede due ETF'});
    for(const criterion of criteria)if(criterion.strategyKey === 'momentum-world-xeon')criterion.thirdIsin='';
    // Trend Following strategies can reference any ETF from the global catalog,
    // even when that ETF is not currently held in the real portfolio.
    const chosen = [...new Set(criteria.flatMap(row => [row.isin,row.benchmarkIsin,row.thirdIsin]).filter(Boolean))];
    if (chosen.length) {
      const { sequelize } = require('../config/database');
      const [catalog] = await sequelize.query(
        'SELECT DISTINCT isin FROM public.anagrafica_etf WHERE isin IN (:isins)',
        { replacements: { isins: chosen } }
      );
      const allowed = new Set(catalog.map(row => String(row.isin).toUpperCase()));
      if (chosen.some(isin => !allowed.has(isin))) return res.status(400).json({ success: false, error: 'ETF non presente nel catalogo' });
    }
    const [row] = await PortfolioTrendStrategy.findOrCreate({
      where: { portfolioId, userId: req.user.id },
      defaults: { portfolioId, userId: req.user.id, strategyKey: 'sma-200', settings: {} }
    });
    // Preserve every unrelated legacy setting and historical selections table.
    const { sequelize } = require('../config/database');
    await sequelize.query(`UPDATE public.portfolio_trend_strategies SET settings = jsonb_set(settings, '{criteria}', CAST(:criteria AS jsonb), true), updated_at = NOW() WHERE portfolio_id = :portfolioId AND user_id = :userId`, { replacements: { portfolioId, userId: req.user.id, criteria: JSON.stringify(criteria) } });
    return res.json({ success: true, data: { criteria } });
  } catch (error) { next(error); }
};
