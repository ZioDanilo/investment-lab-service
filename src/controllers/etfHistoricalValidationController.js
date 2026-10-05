const { EtfHistoricalValidationService } = require('../services/etfHistoricalValidationService');

const evaluate = async (req,res,next) => {
  try {
    const data = EtfHistoricalValidationService.evaluate(req.body || {});
    return res.json({ success:true, data });
  } catch (error) { return next(error); }
};

module.exports={ evaluate };
