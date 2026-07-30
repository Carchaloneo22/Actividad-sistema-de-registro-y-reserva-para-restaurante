'use strict';

async function ensureColumn(queryInterface, table, column, definition) {
  const description = await queryInterface.describeTable(table);
  if (!description[column]) await queryInterface.addColumn(table, column, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await ensureColumn(queryInterface, 'platos', 'factus_tax_code', { type: Sequelize.STRING(4), allowNull: false, defaultValue: '04' });
    await ensureColumn(queryInterface, 'platos', 'factus_tax_rate', { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 8.00 });
    await ensureColumn(queryInterface, 'platos', 'factus_is_excluded', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn(queryInterface, 'platos', 'factus_unit_measure_code', { type: Sequelize.STRING(10), allowNull: false, defaultValue: '94' });
    await ensureColumn(queryInterface, 'platos', 'factus_standard_code', { type: Sequelize.STRING(10), allowNull: false, defaultValue: '999' });

    await ensureColumn(queryInterface, 'clientes', 'tipo_documento_codigo', { type: Sequelize.STRING(4), allowNull: false, defaultValue: '13' });
    await ensureColumn(queryInterface, 'clientes', 'organizacion_legal_codigo', { type: Sequelize.STRING(2), allowNull: false, defaultValue: '2' });
    await ensureColumn(queryInterface, 'clientes', 'tributo_codigo', { type: Sequelize.STRING(4), allowNull: false, defaultValue: 'ZZ' });
    await ensureColumn(queryInterface, 'clientes', 'razon_social', { type: Sequelize.STRING(160), allowNull: true });
    await ensureColumn(queryInterface, 'clientes', 'nombre_comercial', { type: Sequelize.STRING(160), allowNull: true });
    await ensureColumn(queryInterface, 'clientes', 'digito_verificacion', { type: Sequelize.STRING(2), allowNull: true });
    await ensureColumn(queryInterface, 'clientes', 'direccion', { type: Sequelize.STRING(180), allowNull: true });
    await ensureColumn(queryInterface, 'clientes', 'pais_codigo', { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'CO' });
    await ensureColumn(queryInterface, 'clientes', 'municipio_codigo', { type: Sequelize.STRING(10), allowNull: true });

    await ensureColumn(queryInterface, 'detalle_pedidos', 'impuesto_codigo', { type: Sequelize.STRING(4), allowNull: false, defaultValue: '04' });
    await ensureColumn(queryInterface, 'detalle_pedidos', 'impuesto_tasa', { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 8.00 });
    await ensureColumn(queryInterface, 'detalle_pedidos', 'impuesto_valor', { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
    await ensureColumn(queryInterface, 'detalle_pedidos', 'impuesto_excluido', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn(queryInterface, 'detalle_pedidos', 'unidad_medida_codigo', { type: Sequelize.STRING(10), allowNull: false, defaultValue: '94' });
    await ensureColumn(queryInterface, 'detalle_pedidos', 'codigo_estandar', { type: Sequelize.STRING(10), allowNull: false, defaultValue: '999' });

    await ensureColumn(queryInterface, 'pagos', 'factus_payment_method_code', { type: Sequelize.STRING(4), allowNull: true });
    await queryInterface.changeColumn('facturas', 'numero', { type: Sequelize.STRING(80), allowNull: false });
    await ensureColumn(queryInterface, 'facturas', 'proveedor', { type: Sequelize.ENUM('local', 'factus'), allowNull: false, defaultValue: 'local' });
    await ensureColumn(queryInterface, 'facturas', 'estado_electronico', { type: Sequelize.ENUM('no_solicitada', 'procesando', 'validada', 'rechazada', 'error'), allowNull: false, defaultValue: 'no_solicitada' });
    await ensureColumn(queryInterface, 'facturas', 'referencia_externa', { type: Sequelize.STRING(80), allowNull: true, unique: true });
    await ensureColumn(queryInterface, 'facturas', 'cufe', { type: Sequelize.TEXT, allowNull: true });
    await ensureColumn(queryInterface, 'facturas', 'url_publica', { type: Sequelize.TEXT, allowNull: true });
    await ensureColumn(queryInterface, 'facturas', 'url_qr', { type: Sequelize.TEXT, allowNull: true });
    await ensureColumn(queryInterface, 'facturas', 'validada_en', { type: Sequelize.DATE, allowNull: true });
    await ensureColumn(queryInterface, 'facturas', 'enviada_email', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await ensureColumn(queryInterface, 'facturas', 'errores_proveedor', { type: Sequelize.JSON, allowNull: true });
    await ensureColumn(queryInterface, 'facturas', 'respuesta_proveedor', { type: Sequelize.JSON, allowNull: true });

    await queryInterface.sequelize.query(`UPDATE detalle_pedidos d INNER JOIN pedidos p ON p.id = d.pedido_id SET d.impuesto_tasa = CASE WHEN p.subtotal > 0 THEN ROUND((p.impuestos / p.subtotal) * 100, 2) ELSE 0 END`);
    await queryInterface.sequelize.query(`UPDATE detalle_pedidos SET impuesto_valor = ROUND(subtotal * impuesto_tasa / 100, 2) WHERE impuesto_excluido = 0`);
  },

  async down() {
    throw new Error('La reversión de facturación electrónica requiere copia de seguridad y autorización expresa.');
  },
};
