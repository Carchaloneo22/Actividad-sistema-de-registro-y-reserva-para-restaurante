'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = {
      pedidos: 'pedidos',
      facturas: 'facturas',
      platos: 'platos',
      detalles: 'detalle_pedidos',
      configuracion: 'configuracion_restaurantes',
    };
    const ensure = async (table, column, definition) => {
      const description = await queryInterface.describeTable(table);
      if (!description[column]) await queryInterface.addColumn(table, column, definition);
    };
    await ensure(tables.pedidos, 'propina', { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
    await ensure(tables.pedidos, 'propina_porcentaje', { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 0 });
    await ensure(tables.facturas, 'propina', { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 });
    await ensure(tables.configuracion, 'propina_sugerida', { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0.10 });

    await queryInterface.changeColumn(tables.platos, 'factus_tax_code', { type: Sequelize.STRING(4), allowNull: false, defaultValue: '01' });
    await queryInterface.changeColumn(tables.platos, 'factus_tax_rate', { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 19.00 });
    await queryInterface.changeColumn(tables.detalles, 'impuesto_codigo', { type: Sequelize.STRING(4), allowNull: false, defaultValue: '01' });
    await queryInterface.changeColumn(tables.detalles, 'impuesto_tasa', { type: Sequelize.DECIMAL(5, 2), allowNull: false, defaultValue: 19.00 });
    await queryInterface.changeColumn(tables.facturas, 'proveedor', { type: Sequelize.ENUM('local', 'factus', 'factus_mock'), allowNull: false, defaultValue: 'local' });
    await queryInterface.changeColumn(tables.facturas, 'estado_electronico', { type: Sequelize.ENUM('no_solicitada', 'procesando', 'simulada', 'validada', 'rechazada', 'error'), allowNull: false, defaultValue: 'no_solicitada' });
    await queryInterface.changeColumn(tables.configuracion, 'impuesto', { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0.19 });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('pedidos', 'propina_porcentaje');
    await queryInterface.removeColumn('pedidos', 'propina');
    await queryInterface.removeColumn('facturas', 'propina');
    await queryInterface.removeColumn('configuracion_restaurantes', 'propina_sugerida');
    await queryInterface.changeColumn('facturas', 'proveedor', { type: Sequelize.ENUM('local', 'factus'), allowNull: false, defaultValue: 'local' });
    await queryInterface.changeColumn('facturas', 'estado_electronico', { type: Sequelize.ENUM('no_solicitada', 'procesando', 'validada', 'rechazada', 'error'), allowNull: false, defaultValue: 'no_solicitada' });
  },
};
