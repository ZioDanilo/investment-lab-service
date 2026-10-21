'use strict';
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
// Apply the accompanying SQL migration before generating a new run.
const MonteCarloRunManifest = sequelize.define('MonteCarloRunManifest', {
  runId: {type:DataTypes.UUID,primaryKey:true,allowNull:false,field:'run_id'},
  schemaVersion: {type:DataTypes.INTEGER,allowNull:false,field:'schema_version'},
  manifestSha256: {type:DataTypes.STRING(64),allowNull:false,field:'manifest_sha256'},
  manifest: {type:DataTypes.JSONB,allowNull:false}
}, {tableName:'monte_carlo_run_manifest',timestamps:false});
module.exports=MonteCarloRunManifest;
