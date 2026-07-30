const crypto = require('node:crypto');

const isProduction = process.env.NODE_ENV === 'production';

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin;
  } catch (_) {
    return null;
  }
}

const configuredOrigins = splitCsv(
  process.env.ALLOWED_ORIGINS ||
  process.env.FRONTEND_URL ||
  'http://localhost:8080'
);

const allowedOrigins = new Set(
  configuredOrigins.map(normalizeOrigin).filter(Boolean)
);

function parsePositiveInt(
  value,
  fallback,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'si', 'sí'].includes(
    String(value).trim().toLowerCase()
  );
}

function validateEnvironment() {
  const required = [
    'DB_HOST',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'JWT_SECRET',
    'COOKIE_SECRET'
  ];

  const missing = required.filter((name) => !process.env[name]);

  if (missing.length) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}`
    );
  }

  const factusEnabled = parseBoolean(process.env.FACTUS_ENABLED, false);
  const factusEnvironment = String(
    process.env.FACTUS_ENV || 'sandbox'
  ).trim().toLowerCase();

  const factusMockMode =
    parseBoolean(process.env.FACTUS_MOCK_MODE, false) ||
    factusEnvironment === 'mock';

  if (factusEnabled) {
    const validEnvironments = ['mock', 'sandbox', 'production'];

    if (!validEnvironments.includes(factusEnvironment)) {
      throw new Error(
        'FACTUS_ENV debe ser mock, sandbox o production'
      );
    }

    // El modo mock es local y no utiliza credenciales ni conexiones externas.
    if (!factusMockMode) {
      const factusRequired = [
        'FACTUS_CLIENT_ID',
        'FACTUS_CLIENT_SECRET',
        'FACTUS_USERNAME',
        'FACTUS_PASSWORD'
      ];

      const factusMissing = factusRequired.filter(
        (name) => !String(process.env[name] || '').trim()
      );

      if (factusMissing.length) {
        throw new Error(
          `Factus real está activo pero faltan variables: ${factusMissing.join(', ')}`
        );
      }

      if (!['sandbox', 'production'].includes(factusEnvironment)) {
        throw new Error(
          'Factus real requiere FACTUS_ENV=sandbox o FACTUS_ENV=production'
        );
      }
    }
  }

  if (isProduction) {
    const weak = [];

    if (String(process.env.JWT_SECRET || '').length < 64) {
      weak.push('JWT_SECRET (mínimo 64 caracteres)');
    }

    if (String(process.env.COOKIE_SECRET || '').length < 64) {
      weak.push('COOKIE_SECRET (mínimo 64 caracteres)');
    }

    if (weak.length) {
      throw new Error(
        `Secretos inseguros para producción: ${weak.join(', ')}`
      );
    }

    if (
      !allowedOrigins.size ||
      [...allowedOrigins].some((origin) => !origin.startsWith('https://'))
    ) {
      throw new Error(
        'ALLOWED_ORIGINS/FRONTEND_URL debe contener únicamente orígenes HTTPS en producción'
      );
    }

    if (!parseBoolean(process.env.TRUST_PROXY, false)) {
      throw new Error(
        'TRUST_PROXY=true es obligatorio en producción detrás de Nginx'
      );
    }

    if (!parseBoolean(process.env.FORCE_HTTPS, true)) {
      throw new Error(
        'FORCE_HTTPS no puede desactivarse en producción'
      );
    }
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && allowedOrigins.has(normalized));
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  isProduction,
  allowedOrigins,
  isAllowedOrigin,
  validateEnvironment,
  parsePositiveInt,
  parseBoolean,
  timingSafeEqualText
};
