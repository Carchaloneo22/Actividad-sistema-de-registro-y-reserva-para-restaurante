const jwt = require('jsonwebtoken');
const { Usuario, Role, TokenRevocado } = require('../models');
const { fail } = require('../utils/response');
const { jwtVerifyOptions } = require('../controllers/authController');

exports.auth = async (req, res, next) => {
  try {
    const token = req.cookies.access_token;
    if (!token) return fail(res, 'Sesión no válida', [], 401);

    const payload = jwt.verify(token, process.env.JWT_SECRET, jwtVerifyOptions());
    if (!payload.jti || !payload.sub || !payload.rol) return fail(res, 'Sesión no válida', [], 401);
    if (await TokenRevocado.findOne({ where: { jti: payload.jti } })) return fail(res, 'Sesión revocada', [], 401);

    const usuario = await Usuario.findByPk(payload.sub, { include: Role });
    if (!usuario || !usuario.activo || !usuario.Role) return fail(res, 'Usuario inactivo o inexistente', [], 401);
    if (usuario.Role.nombre !== payload.rol) return fail(res, 'Los permisos de la sesión cambiaron. Inicia sesión nuevamente.', [], 401);

    req.user = { id: usuario.id, rol: usuario.Role.nombre, usuario };
    req.tokenPayload = payload;

    const passwordChangeAllowed = ['/api/auth/me', '/api/auth/logout', '/api/auth/change-password'];
    if (usuario.debe_cambiar_password && !passwordChangeAllowed.includes(req.originalUrl.split('?')[0])) {
      return fail(res, 'Debes cambiar la contraseña temporal antes de continuar', [], 428);
    }
    return next();
  } catch (_) {
    return fail(res, 'Sesión expirada o inválida', [], 401);
  }
};

exports.roles = (...permitidos) => (req, res, next) => (
  permitidos.includes(req.user.rol)
    ? next()
    : fail(res, 'Acceso denegado', [], 403)
);
