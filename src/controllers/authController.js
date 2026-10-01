const { Op } = require('sequelize');
const User = require('../models/User');

exports.login = async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');

    if (!username || !password) {
      return res.status(401).json({ success: false, error: 'Username o password non corretti' });
    }

    // PostgreSQL '=' may be affected by collation. LIKE with no wildcards keeps
    // the comparison explicitly case-sensitive for both credentials.
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
