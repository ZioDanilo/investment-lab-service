const { sequelize, Op } = require('../config/database');
const Portafoglio = require('../models/Portafoglio');
const PortafoglioEtf = require('../models/PortafoglioEtf');
const ETF = require('../models/ETF');

// Search ETF by ISIN or description (partial match from 3rd char, max 5 results)
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
      attributes: ['id', 'isin', 'name', 'description', 'ticker'],
      where: sequelize.where(
        sequelize.fn('CONCAT', sequelize.col('isin'), ' ', sequelize.col('name'), ' ', sequelize.col('description')),
        Op.iLike,
        `%${q}%`
      ),
      limit: 5
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

    const portafoglio = await Portafoglio.findByPk(id, {
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

    if (!portafoglio) {
      return res.status(404).json({
        success: false,
        error: 'Portafoglio non trovato'
      });
    }

    res.status(200).json({
      success: true,
      data: portafoglio
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
      nome,
      descrizione: descrizione || null
    });

    // Add ETFs
    const etfRecords = etfs.map(e => ({
      portafoglioId: portafoglio.id,
      etfId: e.etfId,
      peso: e.peso
    }));

    await PortafoglioEtf.bulkCreate(etfRecords);

    // Fetch complete portafoglio
    const completedPortafoglio = await Portafoglio.findByPk(portafoglio.id, {
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
    const portafoglio = await Portafoglio.findByPk(id);
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
    const updatedPortafoglio = await Portafoglio.findByPk(id, {
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
