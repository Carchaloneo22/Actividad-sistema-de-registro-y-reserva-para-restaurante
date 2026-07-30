const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Role = sequelize.define('Role', { nombre: { type: DataTypes.STRING(30), unique: true, allowNull: false } });
const Usuario = sequelize.define('Usuario', {
  nombre: { type: DataTypes.STRING(100), allowNull: false }, usuario: { type: DataTypes.STRING(50), unique: true, allowNull: false },
  correo: { type: DataTypes.STRING(120), unique: true, allowNull: false, validate: { isEmail: true } }, password_hash: { type: DataTypes.STRING, allowNull: false },
  activo: { type: DataTypes.BOOLEAN, defaultValue: true }, debe_cambiar_password: { type: DataTypes.BOOLEAN, defaultValue: true },
  intentos_fallidos: { type: DataTypes.INTEGER, defaultValue: 0 }, bloqueado_hasta: DataTypes.DATE, ultimo_acceso: DataTypes.DATE
});
const Mesero = sequelize.define('Mesero', { codigo: { type: DataTypes.STRING(20), unique: true, allowNull: false }, activo: { type: DataTypes.BOOLEAN, defaultValue: true } });
const Mesa = sequelize.define('Mesa', {
  numero: { type: DataTypes.INTEGER, unique: true, allowNull: false }, zona: DataTypes.STRING(60), capacidad: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  estado: { type: DataTypes.ENUM('disponible','reservada','ocupada','limpieza','fuera_servicio'), defaultValue: 'disponible' }, activo: { type: DataTypes.BOOLEAN, defaultValue: true }
});
const Categoria = sequelize.define('Categoria', { nombre: { type: DataTypes.STRING(70), unique: true, allowNull: false }, activo: { type: DataTypes.BOOLEAN, defaultValue: true } });
const Plato = sequelize.define('Plato', {
  codigo: { type: DataTypes.STRING(20), unique: true, allowNull: false }, nombre: { type: DataTypes.STRING(120), allowNull: false }, descripcion: DataTypes.TEXT,
  precio: { type: DataTypes.DECIMAL(12,2), allowNull: false }, imagen: DataTypes.STRING, tiempo_preparacion: { type: DataTypes.INTEGER, defaultValue: 15 },
  factus_tax_code: { type: DataTypes.STRING(4), defaultValue: '01' },
  factus_tax_rate: { type: DataTypes.DECIMAL(5,2), defaultValue: 19.00 },
  factus_is_excluded: { type: DataTypes.BOOLEAN, defaultValue: false },
  factus_unit_measure_code: { type: DataTypes.STRING(10), defaultValue: '94' },
  factus_standard_code: { type: DataTypes.STRING(10), defaultValue: '999' },
  disponible: { type: DataTypes.BOOLEAN, defaultValue: true }, activo: { type: DataTypes.BOOLEAN, defaultValue: true }
});
const Cliente = sequelize.define('Cliente', {
  nombre: { type: DataTypes.STRING(120), allowNull: false },
  documento: { type: DataTypes.STRING(30), unique: true },
  telefono: { type: DataTypes.STRING(30), allowNull: false },
  correo: { type: DataTypes.STRING(120), validate: { isEmail: true } },
  tipo_documento_codigo: { type: DataTypes.STRING(4), defaultValue: '13' },
  organizacion_legal_codigo: { type: DataTypes.STRING(2), defaultValue: '2' },
  tributo_codigo: { type: DataTypes.STRING(4), defaultValue: 'ZZ' },
  razon_social: DataTypes.STRING(160),
  nombre_comercial: DataTypes.STRING(160),
  digito_verificacion: DataTypes.STRING(2),
  direccion: DataTypes.STRING(180),
  pais_codigo: { type: DataTypes.STRING(3), defaultValue: 'CO' },
  municipio_codigo: DataTypes.STRING(10),
});
const Reserva = sequelize.define('Reserva', {
  codigo: { type: DataTypes.STRING(40), unique: true, allowNull: false }, personas: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, fecha: { type: DataTypes.DATEONLY, allowNull: false },
  hora: { type: DataTypes.TIME, allowNull: false }, observaciones: DataTypes.TEXT, estado: { type: DataTypes.ENUM('pendiente','confirmada','cliente_presente','completada','cancelada','no_asistio'), defaultValue: 'pendiente' }, motivo_cancelacion: DataTypes.TEXT
});
const Pedido = sequelize.define('Pedido', {
  numero: { type: DataTypes.STRING(40), unique: true, allowNull: false }, subtotal: { type: DataTypes.DECIMAL(12,2), defaultValue: 0 }, impuestos: { type: DataTypes.DECIMAL(12,2), defaultValue: 0 },
  descuento: { type: DataTypes.DECIMAL(12,2), defaultValue: 0 },
  propina: { type: DataTypes.DECIMAL(12,2), defaultValue: 0 }, propina_porcentaje: { type: DataTypes.DECIMAL(5,2), defaultValue: 0 },
  total: { type: DataTypes.DECIMAL(12,2), defaultValue: 0 }, notas_cocina: DataTypes.TEXT,
  estado: { type: DataTypes.ENUM('borrador','enviado_despacho','confirmado_despacho','enviado_cocina','en_preparacion','listo','en_entrega','entregado','pagado','cancelado','rechazado'), defaultValue: 'borrador' },
  estado_pago: { type: DataTypes.ENUM('pendiente','parcial','pagado'), defaultValue: 'pendiente' }
});
const DetallePedido = sequelize.define('DetallePedido', {
  cantidad: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false }, precio_unitario: { type: DataTypes.DECIMAL(12,2), allowNull: false }, subtotal: { type: DataTypes.DECIMAL(12,2), allowNull: false },
  observaciones: DataTypes.TEXT,
  impuesto_codigo: { type: DataTypes.STRING(4), defaultValue: '01' },
  impuesto_tasa: { type: DataTypes.DECIMAL(5,2), defaultValue: 19.00 },
  impuesto_valor: { type: DataTypes.DECIMAL(12,2), defaultValue: 0 },
  impuesto_excluido: { type: DataTypes.BOOLEAN, defaultValue: false },
  unidad_medida_codigo: { type: DataTypes.STRING(10), defaultValue: '94' },
  codigo_estandar: { type: DataTypes.STRING(10), defaultValue: '999' },
  estado: { type: DataTypes.ENUM('pendiente','preparando','preparado','no_disponible','cancelado'), defaultValue: 'pendiente' }
});
const HistorialPedido = sequelize.define('HistorialPedido', { estado_anterior: DataTypes.STRING(40), estado_nuevo: DataTypes.STRING(40), observacion: DataTypes.TEXT });
const MetodoPago = sequelize.define('MetodoPago', { nombre: { type: DataTypes.STRING(50), unique: true, allowNull: false }, activo: { type: DataTypes.BOOLEAN, defaultValue: true } });
const Pago = sequelize.define('Pago', { valor: { type: DataTypes.DECIMAL(12,2), allowNull: false }, referencia: DataTypes.STRING(100), recibido: DataTypes.DECIMAL(12,2), cambio: DataTypes.DECIMAL(12,2), factus_payment_method_code: DataTypes.STRING(4) });
const Factura = sequelize.define('Factura', {
  numero: { type: DataTypes.STRING(80), unique: true, allowNull: false },
  subtotal: DataTypes.DECIMAL(12,2), impuestos: DataTypes.DECIMAL(12,2), descuento: DataTypes.DECIMAL(12,2), propina: { type: DataTypes.DECIMAL(12,2), defaultValue: 0 }, total: DataTypes.DECIMAL(12,2),
  proveedor: { type: DataTypes.ENUM('local', 'factus', 'factus_mock'), defaultValue: 'local' },
  estado_electronico: { type: DataTypes.ENUM('no_solicitada', 'procesando', 'simulada', 'validada', 'rechazada', 'error'), defaultValue: 'no_solicitada' },
  referencia_externa: { type: DataTypes.STRING(80), unique: true },
  cufe: DataTypes.TEXT,
  url_publica: DataTypes.TEXT,
  url_qr: DataTypes.TEXT,
  validada_en: DataTypes.DATE,
  enviada_email: { type: DataTypes.BOOLEAN, defaultValue: false },
  errores_proveedor: DataTypes.JSON,
  respuesta_proveedor: DataTypes.JSON,
});
const Configuracion = sequelize.define('ConfiguracionRestaurante', { nombre: DataTypes.STRING(150), nit: DataTypes.STRING(50), direccion: DataTypes.STRING(180), telefono: DataTypes.STRING(40), correo: DataTypes.STRING(120), logo: DataTypes.STRING, impuesto: { type: DataTypes.DECIMAL(5,4), defaultValue: 0.19 }, propina_sugerida: { type: DataTypes.DECIMAL(5,4), defaultValue: 0.10 } });
const Auditoria = sequelize.define('Auditoria', { rol: DataTypes.STRING(30), accion: DataTypes.STRING(80), modulo: DataTypes.STRING(60), registro_id: DataTypes.STRING(60), valores_anteriores: DataTypes.JSON, valores_nuevos: DataTypes.JSON, ip: DataTypes.STRING(64) }, { updatedAt: false });
const Notificacion = sequelize.define('Notificacion', { titulo: DataTypes.STRING(120), mensaje: DataTypes.TEXT, leida: { type: DataTypes.BOOLEAN, defaultValue: false }, tipo: DataTypes.STRING(30) });
const TokenRevocado = sequelize.define('TokenRevocado', { jti: { type: DataTypes.STRING(80), unique: true }, expira_en: DataTypes.DATE });
const CopiaSeguridad = sequelize.define('CopiaSeguridad', { archivo: DataTypes.STRING(255), estado: DataTypes.STRING(30), tamano: DataTypes.BIGINT });

Role.hasMany(Usuario); Usuario.belongsTo(Role);
Usuario.hasOne(Mesero); Mesero.belongsTo(Usuario);
Mesero.hasMany(Mesa); Mesa.belongsTo(Mesero);
Categoria.hasMany(Plato); Plato.belongsTo(Categoria);
Cliente.hasMany(Reserva); Reserva.belongsTo(Cliente);
Mesa.hasMany(Reserva); Reserva.belongsTo(Mesa);
Mesero.hasMany(Reserva); Reserva.belongsTo(Mesero);
Usuario.hasMany(Reserva, { foreignKey: 'creado_por' }); Reserva.belongsTo(Usuario, { foreignKey: 'creado_por', as: 'creador' });
Mesa.hasMany(Pedido); Pedido.belongsTo(Mesa);
Reserva.hasMany(Pedido); Pedido.belongsTo(Reserva);
Cliente.hasMany(Pedido); Pedido.belongsTo(Cliente);
Mesero.hasMany(Pedido); Pedido.belongsTo(Mesero);
Usuario.hasMany(Pedido, { foreignKey: 'creado_por' }); Pedido.belongsTo(Usuario, { foreignKey: 'creado_por', as: 'creador' });
Pedido.hasMany(DetallePedido, { as: 'detalles' }); DetallePedido.belongsTo(Pedido);
Plato.hasMany(DetallePedido); DetallePedido.belongsTo(Plato);
Pedido.hasMany(HistorialPedido); HistorialPedido.belongsTo(Pedido); Usuario.hasMany(HistorialPedido); HistorialPedido.belongsTo(Usuario);
Pedido.hasMany(Pago); Pago.belongsTo(Pedido); MetodoPago.hasMany(Pago); Pago.belongsTo(MetodoPago); Usuario.hasMany(Pago); Pago.belongsTo(Usuario);
Pedido.hasOne(Factura); Factura.belongsTo(Pedido); Usuario.hasMany(Auditoria); Auditoria.belongsTo(Usuario); Usuario.hasMany(Notificacion); Notificacion.belongsTo(Usuario);

module.exports = { sequelize, Role, Usuario, Mesero, Mesa, Categoria, Plato, Cliente, Reserva, Pedido, DetallePedido, HistorialPedido, MetodoPago, Pago, Factura, Configuracion, Auditoria, Notificacion, TokenRevocado, CopiaSeguridad };
