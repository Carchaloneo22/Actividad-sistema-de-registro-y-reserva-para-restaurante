require('dotenv').config();
const bcrypt = require('bcryptjs');
const M = require('../models');

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
  throw new Error('El seed de demostración está bloqueado en producción');
}

const categoryAssociation = Object.values(M.Plato.associations).find((association) => association.target === M.Categoria);
const categoryForeignKey = categoryAssociation?.foreignKey || 'CategoriaId';

(async () => {
  await M.sequelize.sync({ alter: false });

  const roles = {};
  for (const nombre of ['administrador', 'mesero', 'despacho', 'cocina']) {
    [roles[nombre]] = await M.Role.findOrCreate({ where: { nombre } });
  }

  const passwordHash = await bcrypt.hash('Demo2026*', 12);
  const users = [
    ['Administrador', 'admin', 'admin@demo.local', 'administrador'],
    ['Despacho', 'despacho', 'despacho@demo.local', 'despacho'],
    ['Cocina 1', 'cocina1', 'cocina1@demo.local', 'cocina'],
    ['Cocina 2', 'cocina2', 'cocina2@demo.local', 'cocina'],
    ['Mesero 1', 'mesero1', 'mesero1@demo.local', 'mesero'],
    ['Mesero 2', 'mesero2', 'mesero2@demo.local', 'mesero'],
    ['Mesero 3', 'mesero3', 'mesero3@demo.local', 'mesero'],
    ['Mesero 4', 'mesero4', 'mesero4@demo.local', 'mesero'],
  ];

  for (const [nombre, usuario, correo, rol] of users) {
    const [createdUser] = await M.Usuario.findOrCreate({
      where: { usuario },
      defaults: { nombre, correo, password_hash: passwordHash, RoleId: roles[rol].id },
    });
    if (rol === 'mesero') {
      await M.Mesero.findOrCreate({
        where: { UsuarioId: createdUser.id },
        defaults: { codigo: `MES-${createdUser.id}` },
      });
    }
  }

  const meseros = await M.Mesero.findAll();
  for (let i = 1; i <= 12; i += 1) {
    await M.Mesa.findOrCreate({
      where: { numero: i },
      defaults: {
        capacidad: i % 3 === 0 ? 6 : 4,
        zona: i <= 6 ? 'Salón' : 'Terraza',
        MeseroId: meseros[(i - 1) % meseros.length].id,
      },
    });
  }

  const categoryNames = ['Entradas', 'Platos fuertes', 'Comidas rápidas', 'Bebidas', 'Postres', 'Adicionales'];
  const categoryIds = {};
  for (const nombre of categoryNames) {
    const [category] = await M.Categoria.findOrCreate({ where: { nombre } });
    categoryIds[nombre] = category.id;
  }

  const dishes = [
    ['ENT01', 'Nachos de la casa', 'Entradas', 18000],
    ['ENT02', 'Alitas BBQ', 'Entradas', 22000],
    ['ENT03', 'Patacones', 'Entradas', 16000],
    ['PF01', 'Lomo en salsa', 'Platos fuertes', 42000],
    ['PF02', 'Pollo grillado', 'Platos fuertes', 34000],
    ['PF03', 'Salmón', 'Platos fuertes', 48000],
    ['PF04', 'Pasta carbonara', 'Platos fuertes', 31000],
    ['CR01', 'Hamburguesa clásica', 'Comidas rápidas', 26000],
    ['CR02', 'Hamburguesa doble', 'Comidas rápidas', 34000],
    ['CR03', 'Perro especial', 'Comidas rápidas', 23000],
    ['CR04', 'Pizza personal', 'Comidas rápidas', 25000],
    ['BEB01', 'Limonada', 'Bebidas', 9000],
    ['BEB02', 'Jugo natural', 'Bebidas', 10000],
    ['BEB03', 'Gaseosa', 'Bebidas', 7000],
    ['BEB04', 'Agua', 'Bebidas', 5000],
    ['POS01', 'Cheesecake', 'Postres', 14000],
    ['POS02', 'Brownie con helado', 'Postres', 15000],
    ['POS03', 'Flan', 'Postres', 12000],
    ['ADI01', 'Porción de papas', 'Adicionales', 8000],
    ['ADI02', 'Ensalada', 'Adicionales', 9000],
  ];

  for (const [codigo, nombre, categoryName, precio] of dishes) {
    const categoryId = categoryIds[categoryName];
    const [dish, created] = await M.Plato.findOrCreate({
      where: { codigo },
      defaults: {
        nombre,
        [categoryForeignKey]: categoryId,
        precio,
        descripcion: nombre,
        tiempo_preparacion: 15,
        factus_tax_code: '01',
        factus_tax_rate: 19.00,
      },
    });

    // Repara instalaciones creadas antes de corregir el nombre automático
    // de la llave foránea de categorías en Sequelize.
    if (!created) {
      const updates = { factus_tax_code: '01', factus_tax_rate: 19.00 };
      if (Number(dish.get(categoryForeignKey)) !== Number(categoryId)) updates[categoryForeignKey] = categoryId;
      await dish.update(updates);
    }
  }

  for (const nombre of ['Efectivo', 'Tarjeta', 'Transferencia', 'Pago mixto', 'Otro']) {
    await M.MetodoPago.findOrCreate({ where: { nombre } });
  }

  await M.Configuracion.findOrCreate({
    where: { id: 1 },
    defaults: {
      nombre: 'Restaurante Demo',
      nit: '900000000-1',
      direccion: 'Dirección por configurar',
      telefono: '3000000000',
      correo: 'contacto@demo.local',
      impuesto: 0.19,
      propina_sugerida: 0.10,
    },
  });

  console.log('Seed completado. Categorías reparadas, IVA 19% y propina sugerida 10% configurados. Credencial desarrollo: admin / Demo2026*');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
