const { Auditoria } = require('../models');

const SECRET_KEYS = /password|password_hash|token|authorization|cookie|secret/i;

function redact(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item, depth + 1);
  }
  return result;
}

exports.audit = async ({ req, accion, modulo, registroId, antes, despues }) => Auditoria.create({
  UsuarioId: req.user?.id || null,
  rol: req.user?.rol || 'anonimo',
  accion,
  modulo,
  registro_id: registroId || null,
  valores_anteriores: antes ? redact(antes) : null,
  valores_nuevos: despues ? redact(despues) : null,
  ip: req.ip,
});
