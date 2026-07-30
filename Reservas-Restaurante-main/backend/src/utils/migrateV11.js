require('dotenv').config();
const { DataTypes } = require('sequelize');
const {
  sequelize,
  Plato,
  DetallePedido,
  Pedido,
  Factura,
  Configuracion,
} = require('../models');

async function ensureColumn(qi, table, column, definition) {
  const description = await qi.describeTable(table);
  if (!description[column]) {
    await qi.addColumn(table, column, definition);
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
    detalles: DetallePedido.getTableName(),
    pedidos: Pedido.getTableName(),
    facturas: Factura.getTableName(),
    configuracion: Configuracion.getTableName(),
  };

  await ensureColumn(qi, tables.pedidos, 'propina', { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  await ensureColumn(qi, tables.pedidos, 'propina_porcentaje', { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 });
  await ensureColumn(qi, tables.facturas, 'propina', { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
  await ensureColumn(qi, tables.configuracion, 'propina_sugerida', { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0.10 });

  await qi.changeColumn(tables.platos, 'factus_tax_code', { type: DataTypes.STRING(4), allowNull: false, defaultValue: '01' });
  await qi.changeColumn(tables.platos, 'factus_tax_rate', { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 19.00 });
  await qi.changeColumn(tables.detalles, 'impuesto_codigo', { type: DataTypes.STRING(4), allowNull: false, defaultValue: '01' });
  await qi.changeColumn(tables.detalles, 'impuesto_tasa', { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 19.00 });
  await qi.changeColumn(tables.facturas, 'proveedor', {
    type: DataTypes.ENUM('local', 'factus', 'factus_mock'),
    allowNull: false,
    defaultValue: 'local',
  });
  await qi.changeColumn(tables.facturas, 'estado_electronico', {
    type: DataTypes.ENUM('no_solicitada', 'procesando', 'simulada', 'validada', 'rechazada', 'error'),
    allowNull: false,
    defaultValue: 'no_solicitada',
  });
  await qi.changeColumn(tables.configuracion, 'impuesto', { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0.19 });

  const q = qi.queryGenerator;
  const platos = q.quoteTable(tables.platos);
  const detalles = q.quoteTable(tables.detalles);
  const pedidos = q.quoteTable(tables.pedidos);
  const configuracion = q.quoteTable(tables.configuracion);

  // V11 adopta IVA del 19% para la beta. Los productos marcados como excluidos conservan tasa 0.
  await sequelize.query(`UPDATE ${platos} SET factus_tax_code='01', factus_tax_rate=19.00 WHERE factus_is_excluded=0`);
  await sequelize.query(`UPDATE ${configuracion} SET impuesto=0.19, propina_sugerida=0.10`);

  // Recalcula únicamente pedidos no pagados; los comprobantes históricos quedan intactos.
  await sequelize.query(`UPDATE ${detalles} d INNER JOIN ${pedidos} p ON p.id=d.pedido_id SET d.impuesto_codigo='01', d.impuesto_tasa=19.00, d.impuesto_valor=ROUND(d.subtotal*0.19,2) WHERE p.estado_pago<>'pagado' AND d.impuesto_excluido=0`);
  await sequelize.query(`UPDATE ${detalles} d INNER JOIN ${pedidos} p ON p.id=d.pedido_id SET d.impuesto_valor=0, d.impuesto_tasa=0 WHERE p.estado_pago<>'pagado' AND d.impuesto_excluido=1`);
  await sequelize.query(`UPDATE ${pedidos} p SET p.impuestos=COALESCE((SELECT ROUND(SUM(d.impuesto_valor),2) FROM ${detalles} d WHERE d.pedido_id=p.id),0), p.propina=0, p.propina_porcentaje=0 WHERE p.estado_pago<>'pagado'`);
  await sequelize.query(`UPDATE ${pedidos} SET total=ROUND(subtotal+impuestos-descuento+propina,2) WHERE estado_pago<>'pagado'`);

  console.log('Migración V11 completada: Factus simulado, IVA 19% y propina sugerida 10%.');
}

run()
  .catch((error) => {
    console.error('No fue posible ejecutar la migración V11:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
