const User = require('../models/User');

exports.login = async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false, error: 'Username obbligatorio' });

    const [user, created] = await User.findOrCreate({
      where: { username },
      defaults: { username }
    });

    res.status(200).json({
      success: true,
      created,
      data: { id: user.id, username: user.username }
    });
  } catch (error) {
    next(error);
  }
};
