const fs = require('node:fs');
const path = require('node:path');
const winston = require('winston');

const logPath = path.resolve(process.env.LOG_PATH || './logs');
try { fs.mkdirSync(logPath, { recursive: true }); } catch (_) { /* La consola seguirá disponible. */ }

const SENSITIVE_KEYS = /password|password_hash|token|authorization|cookie|secret|db_password|jwt/i;

function redact(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== 'object') return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redact(item, depth + 1);
  }
  return copy;
}

const redactFormat = winston.format((info) => Object.assign(info, redact(info)));
const transports = [new winston.transports.Console()];

try {
  transports.push(
    new winston.transports.File({ filename: path.join(logPath, 'error.log'), level: 'error', maxsize: 5_000_000, maxFiles: 5 }),
    new winston.transports.File({ filename: path.join(logPath, 'combined.log'), maxsize: 10_000_000, maxFiles: 5 }),
  );
} catch (_) {
  // En entornos de solo lectura se conservan los logs por consola.
}

module.exports = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: winston.format.combine(redactFormat(), winston.format.timestamp(), winston.format.json()),
  transports,
});
