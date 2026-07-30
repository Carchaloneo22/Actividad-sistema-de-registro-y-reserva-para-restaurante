const { ValidationError, UniqueConstraintError, ForeignKeyConstraintError, DatabaseError } = require('sequelize');
const logger = require('../utils/logger');

module.exports = (err, req, res, next) => {
  let status = Number(err.status) || 500;
  let message = status < 500 ? err.message : 'Error interno del servidor';
  let errors = err.errors || [];

  if (err instanceof UniqueConstraintError) {
    status = 409;
    message = 'Ya existe un registro con uno de los datos suministrados';
    errors = err.errors.map((item) => ({ field: item.path, message: 'Valor duplicado' }));
  } else if (err instanceof ValidationError) {
    status = 422;
    message = 'Los datos no cumplen las reglas del sistema';
    errors = err.errors.map((item) => ({ field: item.path, message: item.message }));
  } else if (err instanceof ForeignKeyConstraintError) {
    status = 409;
    message = 'La operación afecta información relacionada';
  } else if (err instanceof DatabaseError) {
    status = 500;
    message = 'No fue posible completar la operación en la base de datos';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'La solicitud supera el tamaño permitido';
  } else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    status = 400;
    message = 'El cuerpo JSON no es válido';
  }

  logger.error({
    event: 'request_error',
    request_id: req.id,
    method: req.method,
    path: req.originalUrl,
    status,
    message: err.message,
    code: err.code,
    user_id: req.user?.id,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });

  if (res.headersSent) return next(err);
  return res.status(status).json({
    success: false,
    message,
    data: {},
    errors: status < 500 ? errors : [],
    request_id: req.id,
  });
};
