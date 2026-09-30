const User = require('../models/User');

module.exports = async (req, res, next) => {
  try {
    const username = String(req.get('X-Username') ?? '').trim().toLowerCase();
    if (!username) return res.status(401).json({ success: false, error: 'Utente non autenticato' });

    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(401).json({ success: false, error: 'Utente non riconosciuto' });

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};
