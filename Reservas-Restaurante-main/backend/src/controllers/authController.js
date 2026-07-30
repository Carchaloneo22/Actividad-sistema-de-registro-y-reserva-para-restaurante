const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { Usuario, Role, TokenRevocado } = require('../models');
const { ok, fail } = require('../utils/response');
const { audit } = require('../services/auditService');
const { isProduction, parsePositiveInt } = require('../config/security');
const { issueCsrfToken, clearCsrfToken } = require('../middlewares/security');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('ReservaRest-dummy-password-not-valid', 12);
const SESSION_COOKIE = 'access_token';

function jwtSignOptions() {
  return {
    algorithm: 'HS256',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    issuer: process.env.JWT_ISSUER || 'reservarest-api',
    audience: process.env.JWT_AUDIENCE || 'reservarest-web',
  };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: parsePositiveInt(process.env.SESSION_COOKIE_HOURS, 8, 1, 24) * 60 * 60 * 1000,
  };
}

function signSession(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: String(user.id), rol: user.Role.nombre, jti },
    process.env.JWT_SECRET,
    jwtSignOptions(),
  );
  return { token, jti };
}

exports.csrf = async (req, res) => {
  issueCsrfToken(req, res);
  return ok(res, 'Protección CSRF preparada', { ready: true });
};

exports.login = async (req, res) => {
  const identificador = String(req.body.identificador || '').trim();
  const password = String(req.body.password || '');
  const user = await Usuario.findOne({
    where: { [Op.or]: [{ usuario: identificador }, { correo: identificador }] },
    include: Role,
  });

  const passwordHash = user?.password_hash || DUMMY_PASSWORD_HASH;
  const passwordMatches = await bcrypt.compare(password, passwordHash);

  if (user?.bloqueado_hasta && user.bloqueado_hasta > new Date()) {
    return fail(res, 'Usuario bloqueado temporalmente. Intenta más tarde.', [], 423);
  }

  if (!user || !user.activo || !passwordMatches) {
    if (user?.activo) {
      const intentos = Number(user.intentos_fallidos || 0) + 1;
      await user.update({
        intentos_fallidos: intentos,
        bloqueado_hasta: intentos >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      });
      await audit({
        req: { ...req, user: { id: user.id, rol: user.Role?.nombre || 'desconocido' } },
        accion: 'LOGIN_FALLIDO',
        modulo: 'auth',
        registroId: user.id,
      });
    } else {
      await audit({ req, accion: 'LOGIN_FALLIDO', modulo: 'auth', registroId: null });
    }
    return fail(res, 'Credenciales incorrectas', [], 401);
  }

  await user.update({ intentos_fallidos: 0, bloqueado_hasta: null, ultimo_acceso: new Date() });
  const { token } = signSession(user);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  issueCsrfToken(req, res);

  await audit({
    req: { ...req, user: { id: user.id, rol: user.Role.nombre } },
    accion: 'LOGIN',
    modulo: 'auth',
    registroId: user.id,
  });

  return ok(res, 'Inicio de sesión exitoso', {
    user: {
      id: user.id,
      nombre: user.nombre,
      rol: user.Role.nombre,
      debe_cambiar_password: user.debe_cambiar_password,
    },
  });
};

exports.me = async (req, res) => ok(res, 'Perfil', {
  id: req.user.usuario.id,
  nombre: req.user.usuario.nombre,
  usuario: req.user.usuario.usuario,
  correo: req.user.usuario.correo,
  rol: req.user.rol,
  debe_cambiar_password: req.user.usuario.debe_cambiar_password,
});

exports.logout = async (req, res) => {
  if (req.tokenPayload?.jti && req.tokenPayload?.exp) {
    await TokenRevocado.findOrCreate({
      where: { jti: req.tokenPayload.jti },
      defaults: { expira_en: new Date(req.tokenPayload.exp * 1000) },
    });
  }
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  clearCsrfToken(res);
  return ok(res, 'Sesión cerrada');
};

exports.changePassword = async (req, res) => {
  const { actual, nueva } = req.body;
  const user = req.user.usuario;
  if (!await bcrypt.compare(actual, user.password_hash)) return fail(res, 'La contraseña actual no coincide', [], 400);
  if (await bcrypt.compare(nueva, user.password_hash)) return fail(res, 'La nueva contraseña debe ser diferente', [], 422);

  await user.update({ password_hash: await bcrypt.hash(nueva, 12), debe_cambiar_password: false });
  await TokenRevocado.findOrCreate({
    where: { jti: req.tokenPayload.jti },
    defaults: { expira_en: new Date(req.tokenPayload.exp * 1000) },
  });

  const refreshed = await Usuario.findByPk(user.id, { include: Role });
  const { token } = signSession(refreshed);
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  issueCsrfToken(req, res);
  await audit({ req, accion: 'CAMBIO_PASSWORD', modulo: 'auth', registroId: user.id });
  return ok(res, 'Contraseña actualizada');
};

exports.sessionCookieOptions = sessionCookieOptions;
exports.jwtVerifyOptions = () => ({
  algorithms: ['HS256'],
  issuer: process.env.JWT_ISSUER || 'reservarest-api',
  audience: process.env.JWT_AUDIENCE || 'reservarest-web',
  clockTolerance: 5,
});
