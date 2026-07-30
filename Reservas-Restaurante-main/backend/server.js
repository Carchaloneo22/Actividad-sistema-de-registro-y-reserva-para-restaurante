require('dotenv').config();

const http = require('node:http');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Server } = require('socket.io');
const app = require('./src/app');
const { sequelize, Usuario, Role, TokenRevocado } = require('./src/models');
const logger = require('./src/utils/logger');
const {
  isProduction,
  isAllowedOrigin,
  validateEnvironment,
  parsePositiveInt,
} = require('./src/config/security');

validateEnvironment();

const server = http.createServer(app);
server.requestTimeout = parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 30_000, 5_000, 120_000);
server.headersTimeout = parsePositiveInt(process.env.HEADERS_TIMEOUT_MS, 15_000, 5_000, 60_000);
server.keepAliveTimeout = parsePositiveInt(process.env.KEEP_ALIVE_TIMEOUT_MS, 5_000, 1_000, 30_000);
server.maxRequestsPerSocket = parsePositiveInt(process.env.MAX_REQUESTS_PER_SOCKET, 1000, 10, 10000);

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('Origen de Socket.IO no autorizado'));
    },
    credentials: true,
  },
  allowRequest(req, callback) {
    const origin = req.headers.origin;
    callback(null, !origin || isAllowedOrigin(origin));
  },
  maxHttpBufferSize: 100_000,
  perMessageDeflate: false,
  pingTimeout: 20_000,
  pingInterval: 25_000,
});

function readCookie(header, name) {
  const cookies = String(header || '').split(';');
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator === -1) continue;
    const key = cookie.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(cookie.slice(separator + 1).trim());
  }
  return null;
}

const jwtVerifyOptions = {
  algorithms: ['HS256'],
  issuer: process.env.JWT_ISSUER || 'reservarest-api',
  audience: process.env.JWT_AUDIENCE || 'reservarest-web',
  clockTolerance: 5,
};

io.use(async (socket, next) => {
  try {
    const token = readCookie(socket.handshake.headers.cookie, 'access_token');
    if (!token) return next(new Error('Sesión de Socket.IO no válida'));

    const payload = jwt.verify(token, process.env.JWT_SECRET, jwtVerifyOptions);
    if (!payload.jti || await TokenRevocado.findOne({ where: { jti: payload.jti } })) {
      return next(new Error('Sesión de Socket.IO revocada'));
    }

    const usuario = await Usuario.findByPk(payload.sub, { include: Role });
    if (!usuario || !usuario.activo || !usuario.Role) return next(new Error('Usuario inactivo'));
    if (usuario.Role.nombre !== payload.rol) return next(new Error('Los permisos de la sesión cambiaron'));
    if (usuario.debe_cambiar_password) return next(new Error('Debes cambiar la contraseña temporal'));
    socket.userId = Number(usuario.id);
    socket.role = usuario.Role.nombre;
    return next();
  } catch (_) {
    return next(new Error('Sesión de Socket.IO expirada'));
  }
});

app.set('io', io);
io.on('connection', (socket) => {
  socket.join(`usuario:${socket.userId}`);
  socket.join(`rol:${socket.role}`);
  logger.info({ event: 'socket_connected', socket_id: socket.id, usuario_id: socket.userId, rol: socket.role });
  socket.on('disconnect', (reason) => logger.info({ event: 'socket_disconnected', socket_id: socket.id, reason }));
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'shutdown_started', signal });

  const forceTimer = setTimeout(() => process.exit(1), 15_000);
  forceTimer.unref();

  io.close();
  server.close(async () => {
    try {
      await sequelize.close();
      logger.info({ event: 'shutdown_completed' });
      process.exit(0);
    } catch (error) {
      logger.error({ event: 'shutdown_failed', message: error.message });
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => logger.error({ event: 'unhandled_rejection', message: error?.message, stack: error?.stack }));
process.on('uncaughtException', (error) => {
  logger.error({ event: 'uncaught_exception', message: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

(async () => {
  try {
    await sequelize.authenticate();
    if (!isProduction) await sequelize.sync();
    await TokenRevocado.destroy({ where: { expira_en: { [Op.lt]: new Date() } } });

    const port = Number(process.env.PORT || 3000);
    server.listen(port, '0.0.0.0', () => logger.info({ event: 'server_started', port, environment: process.env.NODE_ENV || 'development' }));
  } catch (error) {
    logger.error({ event: 'startup_failed', message: error.message, stack: error.stack });
    process.exit(1);
  }
})();
