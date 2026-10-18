const { Op, fn, col, where } = require('sequelize');
const User = require('../models/User');
const Portafoglio = require('../models/Portafoglio');
const ETF = require('../models/ETF');
const RealPortfolioOperation = require('../models/RealPortfolioOperation');

exports.login = async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');

    if (!username || !password) {
      return res.status(401).json({ success: false, error: 'Username o password non corretti' });
    }

    // Login intentionally remains case-sensitive for both username and password.
    const user = await User.findOne({
      where: {
        username: { [Op.like]: username },
        password: { [Op.like]: password }
      }
    });

    if (!user) {
      return res.status(401).json({ success: false, error: 'Username o password non corretti' });
    }

    res.status(200).json({
      success: true,
      data: { id: user.id, username: user.username, role: user.role === 'ADMIN' ? 'ADMIN' : 'GUEST' }
    });
  } catch (error) {
    next(error);
  }
};

exports.register = async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const birthDate = String(req.body?.birthDate ?? '');
    if (!email || email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: 'Inserisci un indirizzo email valido' });
    }
    const dateMatch = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(birthDate);
    if (!dateMatch) {
      return res.status(400).json({ success: false, error: 'Data di nascita non valida' });
    }
    const year = Number(dateMatch[1]), month = Number(dateMatch[2]), day = Number(dateMatch[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    const today = new Date();
    if (year < 1900 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day || date.getTime() > today.getTime()) {
      return res.status(400).json({ success: false, error: 'Data di nascita non valida' });
    }


    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username e password sono obbligatori' });
    }

    if (username.length > 100 || password.length > 255) {
      return res.status(400).json({ success: false, error: 'Username o password troppo lunghi' });
    }

    // Registration uniqueness is deliberately case-insensitive:
    // "Danilo", "danilo" and "DANILO" identify the same username namespace.
    const existingUser = await User.findOne({
      where: where(fn('LOWER', col('username')), username.toLowerCase())
    });

    if (existingUser) {
      return res.status(409).json({ success: false, error: 'Username già esistente' });
    }

    const user = await User.create({ username, password, email, birthDate, role: 'GUEST' });

    return res.status(201).json({
      success: true,
      data: { id: user.id, username: user.username, role: user.role === 'ADMIN' ? 'ADMIN' : 'GUEST' }
    });
  } catch (error) {
    // Protect against races between two simultaneous registrations.
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, error: 'Username già esistente' });
    }
    next(error);
  }
};

exports.checkUsername = async (req, res, next) => {
  try {
    const username = String(req.query?.username ?? '').trim();
    if (!username) {
      return res.status(200).json({ success: true, data: { available: true } });
    }

    const existingUser = await User.findOne({
      where: where(fn('LOWER', col('username')), username.toLowerCase()),
      attributes: ['id']
    });

    return res.status(200).json({
      success: true,
      data: { available: !existingUser }
    });
  } catch (error) {
    next(error);
  }
};

// Public, aggregate-only landing statistics. No user details are exposed.
exports.getLandingStats = async (_req, res, next) => {
  try {
    const [users, portfolios, etfs, operations] = await Promise.all([
      User.count(),
      Portafoglio.count({ where: { status: 'open' } }),
      ETF.count(),
      RealPortfolioOperation.count({ where: { operationType: ['buy', 'sell'] } })
    ]);
    return res.status(200).json({ success: true, data: { users, portfolios, etfs, operations } });
  } catch (error) {
    next(error);
  }
};
