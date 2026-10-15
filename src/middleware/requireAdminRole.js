const User = require('../models/User');
const { Op } = require('sequelize');

// Transitional check: current API identifies users by X-Username.
// Replace with a verified session/JWT before treating this as a security boundary.
module.exports = async (req, res, next) => {
  try {
    const username = String(req.get('X-Username') || '');
    if (!username) return res.status(403).json({ success: false, error: 'Operazione riservata agli amministratori' });
    const user = await User.findOne({ where: { username: { [Op.eq]: username } }, attributes: ['id', 'role'] });
    if (!user || user.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'Operazione riservata agli amministratori' });
    next();
  } catch (error) { next(error); }
};
