const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RealPortfolioEtf = sequelize.define('RealPortfolioEtf', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
  realPortfolioId: {
    type: DataTypes.UUID, allowNull: false, field: 'real_portfolio_id',
    references: { model: 'portafogli', key: 'id' }
  },
  etfId: {
    type: DataTypes.UUID, allowNull: false, field: 'etf_id',
    references: { model: 'anagrafica_etf', key: 'id' }
  },
  quantity: { type: DataTypes.DECIMAL(24, 8), allowNull: false, defaultValue: 0 }
}, {
  tableName: 'real_portfolio_etf',
  timestamps: false,
  indexes: [{ unique: true, fields: ['real_portfolio_id', 'etf_id'], name: 'unique_real_portfolio_etf' }]
});

module.exports = RealPortfolioEtf;
