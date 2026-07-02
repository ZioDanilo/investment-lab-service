const mongoose = require('mongoose');

const PortfolioSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true
    },
    description: String,
    holdings: [
      {
        etfId: mongoose.Schema.Types.ObjectId,
        weight: {
          type: Number,
          required: true,
          min: 0,
          max: 100
        }
      }
    ],
    kpis: {
      expectedReturn: Number,
      volatility: Number,
      maxDrawdown: Number,
      recoveryMonths: Number,
      robustness: Number
    },
    status: {
      type: String,
      enum: ['active', 'archived'],
      default: 'active'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Portfolio', PortfolioSchema);
