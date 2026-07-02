const mongoose = require('mongoose');

const ETFSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true
    },
    ticker: {
      type: String,
      required: true,
      unique: true
    },
    description: String,
    assetClass: String,
    expense: Number,
    historicalData: [
      {
        date: Date,
        price: Number,
        return: Number
      }
    ],
    metrics: {
      yield: Number,
      volatility: Number,
      beta: Number
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ETF', ETFSchema);
