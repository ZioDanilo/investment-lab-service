const { Op, fn, col, where } = require('sequelize');
const User = require('../models/User');

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
      data: { id: user.id, username: user.username }
    });
  } catch (error) {
    next(error);
  }
};

exports.register = async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');

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

    const user = await User.create({ username, password });

    return res.status(201).json({
      success: true,
      data: { id: user.id, username: user.username }
    });
  } catch (error) {
    // Protect against races between two simultaneous registrations.
    if (error?.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, error: 'Username già esistente' });
    }
    next(error);
  }
};
