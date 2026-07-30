const { body, param, query } = require('express-validator');

const idParam = [param('id').isInt({ min: 1 }).withMessage('Identificador inválido').toInt()];
const optionalText = (field, max) => body(field).optional({ nullable: true }).isString().isLength({ max }).withMessage(`${field} supera la longitud permitida`).trim();
const bcryptSafeLength = (field) => body(field).custom((value) => {
  if (Buffer.byteLength(String(value), 'utf8') > 72) {
    throw new Error('La contraseña no puede superar 72 bytes');
  }
  return true;
});

const mesaCreate = [
  body('numero').isInt({ min: 1, max: 9999 }).toInt(),
  body('capacidad').isInt({ min: 1, max: 100 }).toInt(),
  optionalText('zona', 60),
  body('estado').optional().isIn(['disponible', 'reservada', 'ocupada', 'limpieza', 'fuera_servicio']),
  body('MeseroId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
];

const mesaUpdate = [
  ...idParam,
  body('numero').optional().isInt({ min: 1, max: 9999 }).toInt(),
  body('capacidad').optional().isInt({ min: 1, max: 100 }).toInt(),
  optionalText('zona', 60),
  body('estado').optional().isIn(['disponible', 'reservada', 'ocupada', 'limpieza', 'fuera_servicio']),
  body('MeseroId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  body('activo').optional().isBoolean().toBoolean(),
];

const platoCreate = [
  body('codigo').isString().trim().isLength({ min: 1, max: 20 }),
  body('nombre').isString().trim().isLength({ min: 2, max: 120 }),
  optionalText('descripcion', 1000),
  body('precio').isFloat({ min: 0, max: 100000000 }).toFloat(),
  body('CategoriaId').isInt({ min: 1 }).toInt(),
  body('tiempo_preparacion').optional().isInt({ min: 1, max: 600 }).toInt(),
  body('disponible').optional().isBoolean().toBoolean(),
  optionalText('imagen', 255),
  body('factus_tax_code').optional().isIn(['01', '04', '35']),
  body('factus_tax_rate').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('factus_is_excluded').optional().isBoolean().toBoolean(),
  body('factus_unit_measure_code').optional().isString().trim().isLength({ min: 1, max: 10 }),
  body('factus_standard_code').optional().isString().trim().isLength({ min: 1, max: 10 }),
];

const platoUpdate = [
  ...idParam,
  body('codigo').optional().isString().trim().isLength({ min: 1, max: 20 }),
  body('nombre').optional().isString().trim().isLength({ min: 2, max: 120 }),
  optionalText('descripcion', 1000),
  body('precio').optional().isFloat({ min: 0, max: 100000000 }).toFloat(),
  body('CategoriaId').optional().isInt({ min: 1 }).toInt(),
  body('tiempo_preparacion').optional().isInt({ min: 1, max: 600 }).toInt(),
  body('disponible').optional().isBoolean().toBoolean(),
  body('activo').optional().isBoolean().toBoolean(),
  optionalText('imagen', 255),
  body('factus_tax_code').optional().isIn(['01', '04', '35']),
  body('factus_tax_rate').optional().isFloat({ min: 0, max: 100 }).toFloat(),
  body('factus_is_excluded').optional().isBoolean().toBoolean(),
  body('factus_unit_measure_code').optional().isString().trim().isLength({ min: 1, max: 10 }),
  body('factus_standard_code').optional().isString().trim().isLength({ min: 1, max: 10 }),
];

const reservaCreate = [
  body('MesaId').isInt({ min: 1 }).toInt(),
  body('MeseroId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  body('personas').isInt({ min: 1, max: 100 }).toInt(),
  body('fecha').isISO8601({ strict: true, strictSeparator: true }).isLength({ max: 10 }),
  body('hora').matches(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  body('cliente.nombre').isString().trim().isLength({ min: 2, max: 120 }),
  body('cliente.telefono').isString().trim().isLength({ min: 5, max: 30 }),
  body('cliente.documento').optional({ nullable: true }).isString().trim().isLength({ max: 30 }),
  body('cliente.correo').optional({ nullable: true, checkFalsy: true }).isEmail().normalizeEmail().isLength({ max: 120 }),
  optionalText('observaciones', 1000),
];

const motivo = [
  ...idParam,
  body('motivo').isString().trim().isLength({ min: 3, max: 500 }),
];

const pedidoItems = [
  body('items').isArray({ min: 1, max: 100 }),
  body('items.*.PlatoId').isInt({ min: 1 }).toInt(),
  body('items.*.cantidad').isInt({ min: 1, max: 100 }).toInt(),
  body('items.*.observaciones').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
];

const pedidoCreate = [
  body('MesaId').isInt({ min: 1 }).toInt(),
  body('ReservaId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  body('ClienteId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  body('MeseroId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  optionalText('notas_cocina', 1000),
  ...pedidoItems,
];

const pedidoAdditional = [...idParam, ...pedidoItems];

const pedidoStatus = [
  ...idParam,
  body('estado').isIn(['confirmado_despacho', 'enviado_cocina', 'rechazado', 'en_preparacion', 'listo', 'en_entrega', 'entregado', 'cancelado']),
  optionalText('observacion', 500),
];

const detailStatus = [
  ...idParam,
  body('estado').isIn(['pendiente', 'preparando', 'preparado', 'no_disponible', 'cancelado']),
  optionalText('observacion', 500),
];

const payment = [
  ...idParam,
  body('MetodoPagoId').isInt({ min: 1 }).toInt(),
  body('valor').isFloat({ min: 0.01, max: 100000000 }).toFloat(),
  optionalText('referencia', 100),
  body('emitir_factus').optional().isBoolean().toBoolean(),
  body('incluir_propina').optional().isBoolean().toBoolean(),
  body('enviar_email').optional().isBoolean().toBoolean(),
  body('factus_payment_method_code').optional({ nullable: true, checkFalsy: true }).isIn(['1', '10', '20', '42', '47', '48', '49', '71', '72', 'ZZZ']),
  body('factus_customer').optional().isObject(),
  body('factus_customer.consumidor_final').optional().isBoolean().toBoolean(),
  body('factus_customer.identification_document_code').optional({ checkFalsy: true }).isIn(['11', '12', '13', '21', '22', '31', '41', '42', '47', '48', '50', '91']),
  body('factus_customer.identification').optional({ checkFalsy: true }).isString().trim().isLength({ min: 3, max: 30 }).matches(/^\d+$/),
  body('factus_customer.legal_organization_code').optional({ checkFalsy: true }).isIn(['1', '2']),
  body('factus_customer.tribute_code').optional({ checkFalsy: true }).isIn(['01', 'ZZ']),
  body('factus_customer.names').optional({ checkFalsy: true }).isString().trim().isLength({ min: 2, max: 160 }),
  body('factus_customer.company').optional({ checkFalsy: true }).isString().trim().isLength({ min: 2, max: 160 }),
  body('factus_customer.trade_name').optional({ checkFalsy: true }).isString().trim().isLength({ max: 160 }),
  body('factus_customer.dv').optional({ checkFalsy: true }).matches(/^\d$/),
  body('factus_customer.email').optional({ checkFalsy: true }).isEmail().normalizeEmail().isLength({ max: 120 }),
  body('factus_customer.phone').optional({ checkFalsy: true }).isString().trim().isLength({ min: 5, max: 30 }),
  body('factus_customer.address').optional({ checkFalsy: true }).isString().trim().isLength({ max: 180 }),
  body('factus_customer.country_code').optional({ checkFalsy: true }).isString().trim().isLength({ min: 2, max: 3 }),
  body('factus_customer.municipality_code').optional({ checkFalsy: true }).isString().trim().isLength({ min: 3, max: 10 }),
];

const factusInvoiceFile = [
  ...idParam,
  param('type').isIn(['pdf', 'xml']),
];

const factusEmail = [
  ...idParam,
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().isLength({ max: 120 }),
];

const userCreate = [
  body('nombre').isString().trim().isLength({ min: 2, max: 100 }),
  body('usuario').isString().trim().matches(/^[A-Za-z0-9._-]{3,50}$/),
  body('correo').isEmail().normalizeEmail().isLength({ max: 120 }),
  body('password').isStrongPassword({ minLength: 10, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }),
  bcryptSafeLength('password'),
  body('rol').isIn(['administrador', 'mesero', 'despacho', 'cocina']),
  body('codigo').optional({ nullable: true }).isString().trim().matches(/^[A-Za-z0-9._-]{1,20}$/),
];

const userState = [...idParam, body('activo').isBoolean().toBoolean()];

const login = [
  body('identificador').isString().trim().isLength({ min: 1, max: 120 }),
  body('password').isString().isLength({ min: 8, max: 72 }),
  bcryptSafeLength('password'),
];

const changePassword = [
  body('actual').isString().isLength({ min: 8, max: 72 }),
  bcryptSafeLength('actual'),
  body('nueva').isStrongPassword({ minLength: 10, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 1 }).isLength({ max: 72 }),
  bcryptSafeLength('nueva'),
];

const listDateQuery = [
  query('fecha').optional().isISO8601({ strict: true }).isLength({ max: 10 }),
  query('mesa').optional().isInt({ min: 1 }).toInt(),
  query('estado').optional().isString().isLength({ max: 40 }),
];

const reportQuery = [
  query('desde').optional().isISO8601({ strict: true }).isLength({ max: 10 }),
  query('hasta').optional().isISO8601({ strict: true }).isLength({ max: 10 }),
];

module.exports = {
  idParam,
  mesaCreate,
  mesaUpdate,
  platoCreate,
  platoUpdate,
  reservaCreate,
  motivo,
  pedidoCreate,
  pedidoAdditional,
  pedidoStatus,
  detailStatus,
  payment,
  factusInvoiceFile,
  factusEmail,
  userCreate,
  userState,
  login,
  changePassword,
  listDateQuery,
  reportQuery,
};
