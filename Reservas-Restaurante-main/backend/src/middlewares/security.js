const crypto = require('node:crypto');
const xss = require('xss');
const { fail } = require('../utils/response');
const {
  isProduction,
  isAllowedOrigin,
  parsePositiveInt,
  timingSafeEqualText,
  parseBoolean,
} = require('../config/security');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE = 'csrf_token';
const SENSITIVE_STRING_KEYS = new Set(['password', 'actual', 'nueva', 'confirmacion', 'token', 'secret']);
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const REMOTE_URL_KEYS = /^(url|webhook|callback_url|logo_url|imagen_url|image_url)$/i;

function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: parsePositiveInt(process.env.SESSION_COOKIE_HOURS, 8, 1, 24) * 60 * 60 * 1000,
  };
}

function createCsrfToken() {
  const nonce = crypto.randomBytes(32).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.COOKIE_SECRET)
    .update(nonce)
    .digest('base64url');
  return `${nonce}.${signature}`;
}

function verifySignedCsrfToken(token) {
  const [nonce, signature, extra] = String(token || '').split('.');
  if (!nonce || !signature || extra) return false;
  const expected = crypto
    .createHmac('sha256', process.env.COOKIE_SECRET)
    .update(nonce)
    .digest('base64url');
  return timingSafeEqualText(signature, expected);
}

function issueCsrfToken(req, res) {
  const token = createCsrfToken();
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

function clearCsrfToken(res) {
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
}

function requestId(req, res, next) {
  const incoming = String(req.get('x-request-id') || '').trim();
  req.id = /^[A-Za-z0-9._-]{8,80}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}


function enforceHttps(req, res, next) {
  const required = isProduction && parseBoolean(process.env.FORCE_HTTPS, true);
  if (!required || req.secure) return next();
  return fail(res, 'La conexión segura HTTPS es obligatoria', [], 426);
}

function rejectUntrustedOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return fail(res, 'Origen no autorizado', [], 403);
  }

  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (!SAFE_METHODS.has(req.method) && fetchSite === 'cross-site') {
    return fail(res, 'Solicitud entre sitios bloqueada', [], 403);
  }
  return next();
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken) return fail(res, 'Token CSRF ausente o inválido', [], 403);
  if (!timingSafeEqualText(cookieToken, headerToken) || !verifySignedCsrfToken(cookieToken)) {
    return fail(res, 'Token CSRF ausente o inválido', [], 403);
  }
  return next();
}

function securityNoCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
}

function sanitizeObject(value, path = [], stats = { keys: 0, depth: 0 }) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    if (value.length > 200) throw Object.assign(new Error('La solicitud contiene demasiados elementos'), { status: 413 });
    return value.map((item, index) => sanitizeObject(item, [...path, String(index)], stats));
  }
  if (typeof value !== 'object') return value;

  stats.depth = Math.max(stats.depth, path.length);
  if (stats.depth > 12) throw Object.assign(new Error('La solicitud supera la profundidad permitida'), { status: 413 });

  for (const key of Object.keys(value)) {
    stats.keys += 1;
    if (stats.keys > 500) throw Object.assign(new Error('La solicitud contiene demasiados campos'), { status: 413 });
    if (BLOCKED_KEYS.has(key)) throw Object.assign(new Error('Campo no permitido'), { status: 400 });

    const item = value[key];
    if (typeof item === 'string') {
      if (item.includes('\0')) throw Object.assign(new Error('La solicitud contiene caracteres no permitidos'), { status: 400 });
      if (Buffer.byteLength(item, 'utf8') > 20_000) throw Object.assign(new Error(`El campo ${key} es demasiado largo`), { status: 413 });
      if (REMOTE_URL_KEYS.test(key) && /^https?:\/\//i.test(item.trim())) {
        throw Object.assign(new Error('No se permiten direcciones remotas en este campo'), { status: 422 });
      }
      value[key] = SENSITIVE_STRING_KEYS.has(key)
        ? item
        : xss(item.trim(), { whiteList: {}, stripIgnoreTag: true, stripIgnoreTagBody: ['script', 'style'] });
    } else {
      value[key] = sanitizeObject(item, [...path, key], stats);
    }
  }
  return value;
}

function sanitizeRequest(req, res, next) {
  try {
    if (req.body && typeof req.body === 'object') sanitizeObject(req.body);
    if (req.query && typeof req.query === 'object') sanitizeObject(req.query);
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireJsonForMutation(req, res, next) {
  if (SAFE_METHODS.has(req.method) || !req.path.startsWith('/api')) return next();
  const contentLength = Number(req.get('content-length') || 0);
  const hasBody = contentLength > 0 || Boolean(req.get('transfer-encoding'));
  if (hasBody && !req.is('application/json')) return fail(res, 'El contenido debe enviarse como application/json', [], 415);
  return next();
}

module.exports = {
  CSRF_COOKIE,
  csrfCookieOptions,
  issueCsrfToken,
  clearCsrfToken,
  requestId,
  enforceHttps,
  rejectUntrustedOrigin,
  csrfProtection,
  securityNoCache,
  sanitizeRequest,
  sanitizeObject,
  requireJsonForMutation,
};
