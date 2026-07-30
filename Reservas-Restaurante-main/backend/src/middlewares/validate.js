const { validationResult, matchedData } = require('express-validator');
const { fail } = require('../utils/response');

module.exports = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array({ onlyFirstError: true }).map(({ value, nestedErrors, ...safe }) => safe);
    return fail(res, 'Datos inválidos', errors, 422);
  }

  // Los controladores conservan sus listas permitidas; matchedData queda disponible
  // para revisiones y futuras migraciones sin exponer campos no validados.
  req.validated = matchedData(req, { locations: ['body', 'params', 'query'], includeOptionals: true });
  return next();
};
