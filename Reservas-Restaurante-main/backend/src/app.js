require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const routes = require('./routes');
const errorHandler = require('./middlewares/error');
const logger = require('./utils/logger');
const { fail } = require('./utils/response');
const {
  isProduction,
  isAllowedOrigin,
  parsePositiveInt,
  parseBoolean,
} = require('./config/security');
const {
  requestId,
  enforceHttps,
  rejectUntrustedOrigin,
  csrfProtection,
  securityNoCache,
  sanitizeRequest,
  requireJsonForMutation,
} = require('./middlewares/security');

const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
app.set('trust proxy', parseBoolean(process.env.TRUST_PROXY, false) ? 1 : false);

app.use(requestId);
app.use(enforceHttps);
app.use(rejectUntrustedOrigin);
app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 600,
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  crossOriginResourcePolicy: false,
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
}));

app.use(cookieParser(process.env.COOKIE_SECRET));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '256kb', strict: true }));
app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 }));
app.use(requireJsonForMutation);
app.use(sanitizeRequest);

morgan.token('request-id', (req) => req.id);
app.use(morgan(':remote-addr :method :url :status :response-time ms req=:request-id', {
  skip: (req) => req.path === '/api/health',
  stream: { write: (message) => logger.http(message.trim()) },
}));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parsePositiveInt(process.env.GLOBAL_RATE_LIMIT_MAX, 300, 20, 5000),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Demasiadas solicitudes. Intenta nuevamente más tarde.', data: {}, errors: [] },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 10, 3, 100),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { success: false, message: 'Demasiados intentos de acceso. Espera 15 minutos.', data: {}, errors: [] },
});

app.use('/api', securityNoCache, globalLimiter, csrfProtection);
app.use('/api/auth/login', loginLimiter);

app.get('/api/health', (req, res) => res.json({
  success: true,
  message: 'API activa',
  data: { request_id: req.id },
  errors: [],
}));
app.use('/api', routes);

app.use((req, res) => fail(res, 'Ruta no encontrada', [], 404));
app.use(errorHandler);

module.exports = app;
