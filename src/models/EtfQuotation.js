const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const ETF = require('./ETF');

const EtfQuotation = sequelize.define('EtfQuotation', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  isin: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'International Securities Identification Number'
  },
  quotation: {
    type: DataTypes.DECIMAL(15, 4),
    allowNull: true,
    comment: 'ETF price/quotation'
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Date of the quotation (YYYY-MM-DD)'
  }
}, {
  timestamps: true,
  tableName: 'etf_quotations',
  indexes: [
    {
      unique: true,
      fields: ['isin', 'date'],
      name: 'unique_isin_date_idx'
    },
    {
      fields: ['date'],
      name: 'idx_quotation_date'
    },
    {
      fields: ['isin'],
      name: 'idx_quotation_isin'
    }
  ]
});

module.exports = EtfQuotation;
