const { sequelize, Op } = require('../config/database');
const Portafoglio = require('../models/Portafoglio');
const PortafoglioEtf = require('../models/PortafoglioEtf');
const ETF = require('../models/ETF');
const EtfMacroStatistics = require('../models/EtfMacroStatistics');

// Helper to format macro stats into nested object
// NEW SCHEMA: EtfMacroStatistics has 4 records per ETF (one per scenario)
// Compose them back into nested object for frontend
const formatMacroStatistics = (msArray) => {
  if (!msArray || !Array.isArray(msArray) || msArray.length === 0) {
    return undefined;
  }

  // Convert array of 4 records into nested object
  const result = {};
  
  for (const ms of msArray) {
    const scenario = ms.macroScenario || ms.macro_scenario;
    if (!scenario) continue;
    
    // Map scenario name (soft_landing stored as-is in DB)
    const scenarioKey = scenario === 'soft_landing' ? 'softLanding' : scenario;
    
    result[scenarioKey] = {
      expectedReturn: parseFloat(ms.expectedReturn) / 100,  // Convert percentage to decimal
      volatility: parseFloat(ms.volatility) / 100,
      maxDrawdown: parseFloat(ms.maxDrawdown) / 100,
      returnRange: {
        min: parseFloat(ms.returnRangeMin) / 100,
        max: parseFloat(ms.returnRangeMax) / 100
      }
    };
  }
  
  return result;
};

// Search ETF by ISIN or description (partial match from 3rd char, max 30 results)
exports.searchETF = async (req, res, next) => {
  try {
    const { q } = req.query;

    if (!q || q.length < 3) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const etfs = await ETF.findAll({
      attributes: ['id', 'isin', 'name', 'nickname', 'description', 'ticker'],
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.fn('CONCAT', sequelize.col('isin'), ' ', sequelize.col('name'), ' ', sequelize.col('description'))),
        Op.like,
        `%${q.toLowerCase()}%`
      ),
      limit: 30
    });

    res.status(200).json({
      success: true,
      data: etfs
    });
  } catch (error) {
    next(error);
  }
};

// Get all portfolios
exports.getPortafogli = async (req, res, next) => {
  try {
    const portafogli = await Portafoglio.findAll({
      where: { userId: req.user.id },
      include: [{
        model: PortafoglioEtf,
        as: 'etfs',
        include: [{
          model: ETF,
          as: 'etf',
          attributes: ['id', 'isin', 'name', 'description', 'ticker']
        }]
      }],
      order: [['dataCreazione', 'DESC']]
    });

    res.status(200).json({
      success: true,
      data: portafogli
    });
  } catch (error) {
    next(error);
  }
};

// Get single portfolio
exports.getPortafoglioById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const portafoglio = await Portafoglio.findOne({
      where: { id, userId: req.user.id },
      include: [{
        model: PortafoglioEtf,
        as: 'etfs',
        include: [{
          model: ETF,
          as: 'etf',
          include: [{
            model: EtfMacroStatistics,
            as: 'macroStats',
            required: false,
            attributes: ['isin', 'macroScenario', 'expectedReturn', 'volatility', 'maxDrawdown', 'returnRangeMin', 'returnRangeMax']
          }]
        }]
      }]
    });

    if (!portafoglio) {
      return res.status(404).json({
        success: false,
        error: 'Portafoglio non trovato'
      });
    }

    // Format response: flatten holdings with macroStatistics (now array of 4 records)
    const plain = portafoglio.toJSON();
    if (plain.etfs) {
      plain.holdings = plain.etfs.map(pe => {
        const etf = pe.etf || {};
        const msArray = etf.macroStats;  // Now an array
        return {
          id: etf.id,
          etfId: etf.id,
          isin: etf.isin,
          name: etf.name,
          description: etf.description,
          ticker: etf.ticker,
          nickname: etf.nickname || etf.name || etf.ticker || etf.isin,
          fullName: etf.name || etf.description || etf.nickname || etf.isin,
          expense: etf.expense,
          weight: parseFloat(pe.peso) / 100,  // Convert percentage to decimal
          macroStatistics: formatMacroStatistics(msArray)
        };
      });
      delete plain.etfs;
    }

    res.status(200).json({
      success: true,
      data: plain
    });
  } catch (error) {
    next(error);
  }
};

// Create new portfolio
exports.savePortafoglio = async (req, res, next) => {
  try {
    const { nome, descrizione, etfs } = req.body;

    // Validation
    if (!nome || !etfs || etfs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Nome e almeno un ETF sono obbligatori'
      });
    }

    const normalizedName = String(nome).trim();
    const existingNames = await Portafoglio.findAll({ where: { userId: req.user.id }, attributes: ['nome'] });
    if (existingNames.some((item) => String(item.nome).trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
      return res.status(409).json({ success: false, error: 'Nome portafoglio già utilizzato' });
    }

    // Validate total weight
    const totalWeight = etfs.reduce((sum, e) => sum + (e.peso || 0), 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      return res.status(400).json({
        success: false,
        error: `Il peso totale deve essere 100%, attualmente ${totalWeight.toFixed(2)}%`
      });
    }

    // Create portafoglio
    const portafoglio = await Portafoglio.create({
      nome: normalizedName,
      descrizione: descrizione || null,
      userId: req.user.id
    });

    // Add ETFs
    const etfRecords = etfs.map(e => ({
      portafoglioId: portafoglio.id,
      etfId: e.etfId,
      peso: e.peso
    }));

    await PortafoglioEtf.bulkCreate(etfRecords);

    // Fetch complete portafoglio
    const completedPortafoglio = await Portafoglio.findOne({
      where: { id: portafoglio.id, userId: req.user.id },
      include: [{
        model: PortafoglioEtf,
        as: 'etfs',
        include: [{
          model: ETF,
          as: 'etf',
          attributes: ['id', 'isin', 'name', 'description', 'ticker']
        }]
      }]
    });

    res.status(201).json({
      success: true,
      data: completedPortafoglio
    });
  } catch (error) {
    next(error);
  }
};

// Update portfolio (update weights, keep same portfolio ID)
exports.updatePortafoglio = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nome, descrizione, etfs } = req.body;

    // Find portafoglio
    const portafoglio = await Portafoglio.findOne({ where: { id, userId: req.user.id } });
    if (!portafoglio) {
      return res.status(404).json({
        success: false,
        error: 'Portafoglio non trovato'
      });
    }

    // Validate total weight
    const totalWeight = etfs.reduce((sum, e) => sum + (e.peso || 0), 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      return res.status(400).json({
        success: false,
        error: `Il peso totale deve essere 100%, attualmente ${totalWeight.toFixed(2)}%`
      });
    }

    // Update portafoglio
    await portafoglio.update({
      nome: nome || portafoglio.nome,
      descrizione: descrizione !== undefined ? descrizione : portafoglio.descrizione,
      dataModifica: new Date()
    });

    // Update or recreate ETFs
    await PortafoglioEtf.destroy({ where: { portafoglioId: id } });

    const etfRecords = etfs.map(e => ({
      portafoglioId: id,
      etfId: e.etfId,
      peso: e.peso
    }));

    await PortafoglioEtf.bulkCreate(etfRecords);

    // Fetch updated portafoglio
    const updatedPortafoglio = await Portafoglio.findOne({
      where: { id, userId: req.user.id },
      include: [{
        model: PortafoglioEtf,
        as: 'etfs',
        include: [{
          model: ETF,
          as: 'etf',
          attributes: ['id', 'isin', 'name', 'description', 'ticker']
        }]
      }]
    });

    res.status(200).json({
      success: true,
      data: updatedPortafoglio
    });
  } catch (error) {
    next(error);
  }
};

// Delete portfolio
exports.deletePortafoglio = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Find portafoglio
    const portafoglio = await Portafoglio.findOne({ where: { id, userId: req.user.id } });
    if (!portafoglio) {
      return res.status(404).json({
        success: false,
        error: 'Portafoglio non trovato'
      });
    }

    // Delete ETFs associated with portafoglio (cascade)
    await PortafoglioEtf.destroy({ where: { portafoglioId: id } });

    // Delete portafoglio
    await portafoglio.destroy();

    res.status(200).json({
      success: true,
      message: 'Portafoglio eliminato con successo'
    });
  } catch (error) {
    next(error);
  }
};


const ALLOWED_KPI_IDS = new Set([
  'expectedReturn',
  'volatility',
  'positiveReturnProbability',
  'recoveryPeriod',
  'averageMaxDrawdown'
]);

// Get persisted Monte Carlo KPI priority/targets for one portfolio.
exports.getKpiTargets = async (req, res, next) => {
  try {
    const { id } = req.params;
    const portfolio = await Portafoglio.findOne({ where: { id, userId: req.user.id }, attributes: ['id'] });
    if (!portfolio) {
      return res.status(404).json({ success: false, error: 'Portafoglio non trovato' });
    }

    const [rows] = await sequelize.query(
      `SELECT portfolio_id AS "portfolioId", kpi, priority, target
         FROM portfolio_kpi_target
        WHERE portfolio_id = :portfolioId
        ORDER BY priority ASC`,
      { replacements: { portfolioId: id } }
    );

    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
};

// Atomically replace the five persisted KPI rows for one portfolio.
exports.saveKpiTargets = async (req, res, next) => {
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const kpis = Array.isArray(req.body?.kpis) ? req.body.kpis : [];

    const portfolio = await Portafoglio.findOne({ where: { id, userId: req.user.id }, attributes: ['id'], transaction });
    if (!portfolio) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: 'Portafoglio non trovato' });
    }

    const normalized = kpis.map((item) => ({
      kpi: String(item?.kpi ?? ''),
      priority: Number(item?.priority),
      target: item?.target == null ? null : String(item.target)
    }));

    const ids = normalized.map((item) => item.kpi);
    const priorities = normalized.map((item) => item.priority);
    const valid =
      normalized.length === ALLOWED_KPI_IDS.size &&
      normalized.every((item) => ALLOWED_KPI_IDS.has(item.kpi) && Number.isInteger(item.priority) && item.priority >= 1 && item.priority <= 5) &&
      new Set(ids).size === ALLOWED_KPI_IDS.size &&
      new Set(priorities).size === ALLOWED_KPI_IDS.size;

    if (!valid) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        error: 'Configurazione KPI non valida: servono i 5 KPI previsti con priorità univoche da 1 a 5'
      });
    }

    await sequelize.query(
      'DELETE FROM portfolio_kpi_target WHERE portfolio_id = :portfolioId',
      { replacements: { portfolioId: id }, transaction }
    );

    for (const item of normalized) {
      await sequelize.query(
        `INSERT INTO portfolio_kpi_target (portfolio_id, kpi, priority, target)
         VALUES (:portfolioId, :kpi, :priority, :target)`,
        {
          replacements: {
            portfolioId: id,
            kpi: item.kpi,
            priority: item.priority,
            target: item.target
          },
          transaction
        }
      );
    }

    await transaction.commit();
    res.status(200).json({
      success: true,
      data: normalized.map((item) => ({ portfolioId: id, ...item }))
    });
  } catch (error) {
    if (!transaction.finished) {
      await transaction.rollback();
    }
    next(error);
  }
};
