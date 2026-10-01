const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Factor = sequelize.define('Factor', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(160), allowNull: false },
  family: { type: DataTypes.ENUM('asset_class','geography','style','sector','currency','fixed_income','real_asset'), allowNull: false },
  assetClass: { type: DataTypes.STRING(64), allowNull: true },
  parentFactorId: { type: DataTypes.UUID, allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
}, {
  tableName: 'factors',
  timestamps: true,
  indexes: [{ unique: true, fields: ['code'] }, { fields: ['family','active'] }]
});

module.exports = Factor;
