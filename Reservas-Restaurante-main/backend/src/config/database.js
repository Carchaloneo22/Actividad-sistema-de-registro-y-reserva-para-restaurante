const { Sequelize } = require('sequelize');
require('dotenv').config();
const { parseBoolean } = require('./security');

const useSsl = parseBoolean(process.env.DB_SSL, false);

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  dialect: 'mysql',
  logging: process.env.NODE_ENV === 'development' && process.env.DB_LOGGING === 'true'
    ? (message) => console.debug(message)
    : false,
  benchmark: true,
  define: { underscored: true, timestamps: true },
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: Number(process.env.DB_POOL_MIN || 0),
    acquire: 30_000,
    idle: 10_000,
  },
  retry: { max: 3 },
  dialectOptions: useSsl ? {
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  } : {},
});

module.exports = sequelize;
