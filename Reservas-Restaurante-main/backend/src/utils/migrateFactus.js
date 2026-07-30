require('dotenv').config();
const { DataTypes } = require('sequelize');
const {
  sequelize,
  Plato,
  Cliente,
  DetallePedido,
  Pago,
  Factura,
  Pedido,
} = require('../models');

async function ensureColumn(queryInterface, table, column, definition) {
  const description = await queryInterface.describeTable(table);
  if (!description[column]) {
    await queryInterface.addColumn(table, column, definition);
    console.log(`+ ${table}.${column}`);
    return true;
  }
  console.log(`= ${table}.${column}`);
  return false;
}

async function run() {
  await sequelize.authenticate();
  const qi = sequelize.getQueryInterface();
  const tables = {
    platos: Plato.getTableName(),
    clientes: Cliente.getTableName(),
    detalles: DetallePedido.getTableName(),
    pagos: Pago.getTableName(),
    facturas: Factura.getTableName(),
    pedidos: Pedido.getTableName(),
  };

  await ensureColumn(qi, tables.platos, 'factus_tax_code', { type: DataTypes.STRING(4), allowNull: false, defaultValue: '01' });
  await ensureColumn(qi, tables.platos, 'factus_tax_rate', { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 19.00 });
  await ensureColumn(qi, tables.platos, 'factus_is_excluded', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await ensureColumn(qi, tables.platos, 'factus_unit_measure_code', { type: DataTypes.STRING(10), allowNull: false, defaultValue: '94' });
  await ensureColumn(qi, tables.platos, 'factus_standard_code', { type: DataTypes.STRING(10), allowNull: false, defaultValue: '999' });

  await ensureColumn(qi, tables.clientes, 'tipo_documento_codigo', { type: DataTypes.STRING(4), allowNull: false, defaultValue: '13' });
  await ensureColumn(qi, tables.clientes, 'organizacion_legal_codigo', { type: DataTypes.STRING(2), allowNull: false, defaultValue: '2' });
  await ensureColumn(qi, tables.clientes, 'tributo_codigo', { type: DataTypes.STRING(4), allowNull: false, defaultValue: 'ZZ' });
  await ensureColumn(qi, tables.clientes, 'razon_social', { type: DataTypes.STRING(160), allowNull: true });
  await ensureColumn(qi, tables.clientes, 'nombre_comercial', { type: DataTypes.STRING(160), allowNull: true });
  await ensureColumn(qi, tables.clientes, 'digito_verificacion', { type: DataTypes.STRING(2), allowNull: true });
  await ensureColumn(qi, tables.clientes, 'direccion', { type: DataTypes.STRING(180), allowNull: true });
  await ensureColumn(qi, tables.clientes, 'pais_codigo', { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'CO' });
  await ensureColumn(qi, tables.clientes, 'municipio_codigo', { type: DataTypes.STRING(10), allowNull: true });

  await ensureColumn(qi, tables.detalles, 'impuesto_codigo', { type: DataTypes.STRING(4), allowNull: false, defaultValue: '01' });
  const taxRateAdded = await ensureColumn(qi, tables.detalles, 'impuesto_tasa', { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 19.00 });
  const taxValueAdded = await ensureColumn(qi, tables.detalles, 'impuesto_valor', { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  await ensureColumn(qi, tables.detalles, 'impuesto_excluido', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await ensureColumn(qi, tables.detalles, 'unidad_medida_codigo', { type: DataTypes.STRING(10), allowNull: false, defaultValue: '94' });
  await ensureColumn(qi, tables.detalles, 'codigo_estandar', { type: DataTypes.STRING(10), allowNull: false, defaultValue: '999' });

  await ensureColumn(qi, tables.pagos, 'factus_payment_method_code', { type: DataTypes.STRING(4), allowNull: true });

  const facturaDescription = await qi.describeTable(tables.facturas);
  if (!/VARCHAR\(80\)/i.test(String(facturaDescription.numero?.type || ''))) {
    await qi.changeColumn(tables.facturas, 'numero', { type: DataTypes.STRING(80), allowNull: false });
    console.log(`~ ${tables.facturas}.numero VARCHAR(80)`);
  }
  await ensureColumn(qi, tables.facturas, 'proveedor', { type: DataTypes.ENUM('local', 'factus', 'factus_mock'), allowNull: false, defaultValue: 'local' });
  await ensureColumn(qi, tables.facturas, 'estado_electronico', { type: DataTypes.ENUM('no_solicitada', 'procesando', 'simulada', 'validada', 'rechazada', 'error'), allowNull: false, defaultValue: 'no_solicitada' });
  await ensureColumn(qi, tables.facturas, 'referencia_externa', { type: DataTypes.STRING(80), allowNull: true, unique: true });
  await ensureColumn(qi, tables.facturas, 'cufe', { type: DataTypes.TEXT, allowNull: true });
  await ensureColumn(qi, tables.facturas, 'url_publica', { type: DataTypes.TEXT, allowNull: true });
  await ensureColumn(qi, tables.facturas, 'url_qr', { type: DataTypes.TEXT, allowNull: true });
  await ensureColumn(qi, tables.facturas, 'validada_en', { type: DataTypes.DATE, allowNull: true });
  await ensureColumn(qi, tables.facturas, 'enviada_email', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await ensureColumn(qi, tables.facturas, 'errores_proveedor', { type: DataTypes.JSON, allowNull: true });
  await ensureColumn(qi, tables.facturas, 'respuesta_proveedor', { type: DataTypes.JSON, allowNull: true });

  const quotedDetails = qi.queryGenerator.quoteTable(tables.detalles);
  const quotedOrders = qi.queryGenerator.quoteTable(tables.pedidos);
  if (taxRateAdded) {
    await sequelize.query(`UPDATE ${quotedDetails} d INNER JOIN ${quotedOrders} p ON p.id = d.pedido_id SET d.impuesto_tasa = CASE WHEN p.subtotal > 0 THEN ROUND((p.impuestos / p.subtotal) * 100, 2) ELSE 0 END`);
  }
  if (taxRateAdded || taxValueAdded) {
    await sequelize.query(`UPDATE ${quotedDetails} SET impuesto_valor = ROUND(subtotal * impuesto_tasa / 100, 2) WHERE impuesto_excluido = 0`);
  }
  console.log('Migración Factus completada.');
}

run()
  .catch((error) => {
    console.error('No fue posible ejecutar la migración Factus:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
