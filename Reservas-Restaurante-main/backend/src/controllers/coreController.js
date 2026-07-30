const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize,
  Mesa,
  Reserva,
  Cliente,
  Mesero,
  Usuario,
  Pedido,
  DetallePedido,
  Plato,
  HistorialPedido,
  MetodoPago,
  Pago,
  Factura,
  Configuracion,
  Categoria,
  Role,
  Auditoria,
  Notificacion,
} = require('../models');
const { ok, fail } = require('../utils/response');
const { audit } = require('../services/auditService');
const { assertLocalAssetPath } = require('../utils/ssrf');
const factus = require('../services/factusService');
const { calculateBillTotals, roundMoney } = require('../services/billingService');

const num = (value) => Number(value || 0);
const today = () => new Date().toISOString().slice(0, 10);
const activeReservationStates = ['pendiente', 'confirmada', 'cliente_presente'];
const openOrderStates = [
  'borrador',
  'enviado_despacho',
  'confirmado_despacho',
  'enviado_cocina',
  'en_preparacion',
  'listo',
  'en_entrega',
  'entregado',
];

// Sequelize puede pluralizar modelos en español con nombres inesperados.
// Estas ayudas detectan el alias y la llave foránea reales para que la categoría
// se guarde y se devuelva siempre como Categoria / CategoriaId.
const categoriaAssociation = Object.values(Plato.associations).find((association) => association.target === Categoria);
const categoriaAlias = categoriaAssociation?.as || 'Categoria';
const categoriaForeignKey = categoriaAssociation?.foreignKey || 'CategoriaId';
const categoriaInclude = { model: Categoria, as: categoriaAlias };

const normalizePlato = (plato) => {
  const data = plato?.get ? plato.get({ plain: true }) : { ...(plato || {}) };
  const categoria = data[categoriaAlias] || data.Categoria || data.Categorium || null;
  return {
    ...data,
    Categoria: categoria,
    CategoriaId: data[categoriaForeignKey] ?? categoria?.id ?? null,
  };
};

exports.dashboard = async (req, res) => {
  const hoy = today();
  let waiter = null;
  if (req.user.rol === 'mesero') {
    waiter = await Mesero.findOne({ where: { UsuarioId: req.user.id, activo: true } });
  }

  const reservationWhere = { fecha: hoy };
  const orderWhere = {};
  if (req.user.rol === 'mesero') {
    if (!waiter) return ok(res, 'Indicadores', {
      mesas: { total: 0, disponibles: 0, reservadas: 0, ocupadas: 0, limpieza: 0 },
      reservas_hoy: 0, reservas: [],
      pedidos: { total: 0, pendientes: 0, cocina: 0, listos: 0, despachos_activos: 0 },
      platos: { activos: 0, agotados: 0 }, ventas_dia: 0,
    });
    reservationWhere.MeseroId = waiter.id;
    orderWhere.MeseroId = waiter.id;
  } else if (req.user.rol === 'cocina') {
    orderWhere.estado = { [Op.in]: ['enviado_cocina', 'en_preparacion', 'listo'] };
  }

  const paymentWhere = { created_at: { [Op.gte]: new Date(`${hoy}T00:00:00`) } };
  const paymentInclude = req.user.rol === 'mesero'
    ? [{ model: Pedido, where: { MeseroId: waiter.id }, attributes: ['id'], required: true }]
    : [];

  const [mesas, reservas, pedidos, pagos, platos] = await Promise.all([
    Mesa.findAll({ where: { activo: true } }),
    req.user.rol === 'cocina' ? Promise.resolve([]) : Reserva.findAll({
      where: reservationWhere,
      include: [Cliente, Mesa, Mesero],
      order: [['hora', 'ASC']],
    }),
    Pedido.findAll({ where: orderWhere, include: [Mesa] }),
    req.user.rol === 'cocina' ? Promise.resolve([]) : Pago.findAll({ where: paymentWhere, include: paymentInclude }),
    Plato.findAll({ where: { activo: true } }),
  ]);

  return ok(res, 'Indicadores', {
    mesas: {
      total: mesas.length,
      disponibles: mesas.filter((x) => x.estado === 'disponible').length,
      reservadas: mesas.filter((x) => x.estado === 'reservada').length,
      ocupadas: mesas.filter((x) => x.estado === 'ocupada').length,
      limpieza: mesas.filter((x) => x.estado === 'limpieza').length,
    },
    reservas_hoy: reservas.length,
    reservas,
    pedidos: {
      total: pedidos.length,
      pendientes: pedidos.filter((x) => ['enviado_despacho', 'confirmado_despacho'].includes(x.estado)).length,
      cocina: pedidos.filter((x) => ['enviado_cocina', 'en_preparacion'].includes(x.estado)).length,
      listos: pedidos.filter((x) => x.estado === 'listo').length,
      despachos_activos: pedidos.filter((x) => ['listo', 'en_entrega'].includes(x.estado)).length,
    },
    platos: {
      activos: platos.filter((x) => x.disponible).length,
      agotados: platos.filter((x) => !x.disponible).length,
    },
    ventas_dia: pagos.reduce((acc, item) => acc + num(item.valor), 0),
  });
};

exports.listMesas = async (req, res) => {
  const where = req.query.todas === '1' && req.user.rol === 'administrador' ? {} : { activo: true };
  const mesas = await Mesa.findAll({ include: Mesero, where, order: [['numero', 'ASC']] });
  return ok(res, 'Mesas', mesas);
};

exports.createMesa = async (req, res) => {
  const mesa = await Mesa.create({
    numero: req.body.numero,
    capacidad: req.body.capacidad,
    zona: req.body.zona || null,
    estado: req.body.estado || 'disponible',
    MeseroId: req.body.MeseroId || null,
  });
  await audit({ req, accion: 'CREAR', modulo: 'mesas', registroId: mesa.id, despues: mesa.toJSON() });
  return ok(res, 'Mesa creada', mesa, 201);
};

exports.updateMesa = async (req, res) => {
  const mesa = await Mesa.findByPk(req.params.id);
  if (!mesa) return fail(res, 'Mesa no encontrada', [], 404);

  const antes = mesa.toJSON();
  const allowed = ['numero', 'capacidad', 'zona', 'estado', 'MeseroId', 'activo'];
  const changes = {};
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) changes[field] = req.body[field] === '' ? null : req.body[field];
  });
  if (req.body.capacidad) changes.capacidad = Number(req.body.capacidad);
  if (req.body.numero) changes.numero = Number(req.body.numero);

  await mesa.update(changes);
  await audit({ req, accion: 'EDITAR', modulo: 'mesas', registroId: mesa.id, antes, despues: mesa.toJSON() });
  return ok(res, 'Mesa actualizada', mesa);
};

exports.deleteMesa = async (req, res) => {
  const mesa = await Mesa.findByPk(req.params.id);
  if (!mesa) return fail(res, 'Mesa no encontrada', [], 404);

  const [reservaActiva, pedidoActivo] = await Promise.all([
    Reserva.findOne({ where: { MesaId: mesa.id, estado: { [Op.in]: activeReservationStates } } }),
    Pedido.findOne({ where: { MesaId: mesa.id, estado: { [Op.in]: openOrderStates }, estado_pago: { [Op.ne]: 'pagado' } } }),
  ]);
  if (reservaActiva || pedidoActivo) return fail(res, 'No se puede desactivar una mesa con reserva o pedido activo', [], 409);

  await mesa.update({ activo: false, estado: 'fuera_servicio' });
  await audit({ req, accion: 'ELIMINACION_LOGICA', modulo: 'mesas', registroId: mesa.id, despues: mesa.toJSON() });
  return ok(res, 'Mesa desactivada', mesa);
};

exports.occupyTable = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const mesa = await Mesa.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!mesa || !mesa.activo) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });
    if (['ocupada', 'limpieza', 'fuera_servicio'].includes(mesa.estado)) {
      throw Object.assign(new Error('La mesa no puede ocuparse en su estado actual'), { status: 409 });
    }

    const changes = { estado: 'ocupada' };
    if (req.user.rol === 'mesero') {
      if (mesa.estado === 'reservada') {
        throw Object.assign(new Error('La llegada de una reserva debe confirmarla despacho/caja'), { status: 403 });
      }
      const waiter = await Mesero.findOne({ where: { UsuarioId: req.user.id, activo: true }, transaction });
      if (!waiter) throw Object.assign(new Error('El usuario no tiene un perfil de mesero activo'), { status: 409 });
      if (mesa.MeseroId && Number(mesa.MeseroId) !== Number(waiter.id)) {
        throw Object.assign(new Error('La mesa está asignada a otro mesero'), { status: 403 });
      }
      changes.MeseroId = waiter.id;
    }

    await mesa.update(changes, { transaction });
    await transaction.commit();
    await audit({ req, accion: 'OCUPAR', modulo: 'mesas', registroId: mesa.id, despues: mesa.toJSON() });
    return ok(res, 'Mesa marcada como ocupada', mesa);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.releaseTable = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const mesa = await Mesa.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!mesa) throw Object.assign(new Error('Mesa no encontrada'), { status: 404 });

    if (req.user.rol === 'mesero') {
      const waiter = await Mesero.findOne({ where: { UsuarioId: req.user.id, activo: true }, transaction });
      const ownOrder = waiter ? await Pedido.findOne({ where: { MesaId: mesa.id, MeseroId: waiter.id }, transaction }) : null;
      if (!waiter || (mesa.MeseroId && Number(mesa.MeseroId) !== Number(waiter.id) && !ownOrder)) {
        throw Object.assign(new Error('No tienes permiso para liberar esta mesa'), { status: 403 });
      }
    }

    const pendiente = await Pedido.findOne({
      where: {
        MesaId: mesa.id,
        estado_pago: { [Op.ne]: 'pagado' },
        estado: { [Op.notIn]: ['cancelado', 'rechazado'] },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (pendiente) throw Object.assign(new Error('No se puede liberar una mesa con cuenta pendiente'), { status: 409 });

    await mesa.update({ estado: 'disponible', MeseroId: null }, { transaction });
    await transaction.commit();
    await audit({ req, accion: 'LIBERAR', modulo: 'mesas', registroId: mesa.id, despues: mesa.toJSON() });
    return ok(res, 'Mesa liberada', mesa);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.listMeseros = async (req, res) => {
  const where = { activo: true };
  if (req.user.rol === 'mesero') where.UsuarioId = req.user.id;
  const meseros = await Mesero.findAll({
    where,
    include: [{ model: Usuario, attributes: ['id', 'nombre', 'usuario', 'activo'] }],
    order: [['codigo', 'ASC']],
  });
  return ok(res, 'Meseros', meseros);
};

exports.listCatalog = async (req, res) => {
  const categorias = await Categoria.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] });
  const platos = await Plato.findAll({
    where: { activo: true },
    include: [categoriaInclude],
    order: [['nombre', 'ASC']],
  });
  return ok(res, 'Catálogo', { categorias, platos: platos.map(normalizePlato) });
};

exports.listPlatos = async (req, res) => {
  const where = req.user.rol === 'administrador' && req.query.todos === '1' ? {} : { activo: true };
  const platos = await Plato.findAll({ where, include: [categoriaInclude], order: [['nombre', 'ASC']] });
  return ok(res, 'Platos', platos.map(normalizePlato));
};

exports.createPlato = async (req, res) => {
  const categoriaId = Number(req.body.CategoriaId);
  const categoria = await Categoria.findOne({ where: { id: categoriaId, activo: true } });
  if (!categoria) return fail(res, 'La categoría seleccionada no existe o está inactiva', [], 422);

  const plato = await Plato.create({
    codigo: req.body.codigo,
    nombre: req.body.nombre,
    descripcion: req.body.descripcion || null,
    [categoriaForeignKey]: categoria.id,
    precio: req.body.precio,
    tiempo_preparacion: req.body.tiempo_preparacion || 15,
    imagen: assertLocalAssetPath(req.body.imagen),
    factus_tax_code: req.body.factus_tax_code || process.env.FACTUS_DEFAULT_TAX_CODE || '01',
    factus_tax_rate: req.body.factus_tax_rate ?? process.env.FACTUS_DEFAULT_TAX_RATE ?? 19,
    factus_is_excluded: req.body.factus_is_excluded === true,
    factus_unit_measure_code: req.body.factus_unit_measure_code || '94',
    factus_standard_code: req.body.factus_standard_code || '999',
    disponible: req.body.disponible !== false,
    activo: true,
  });
  const creado = await Plato.findByPk(plato.id, { include: [categoriaInclude] });
  await audit({ req, accion: 'CREAR', modulo: 'platos', registroId: plato.id, despues: normalizePlato(creado) });
  return ok(res, 'Plato creado', normalizePlato(creado), 201);
};

exports.updatePlato = async (req, res) => {
  const plato = await Plato.findByPk(req.params.id);
  if (!plato) return fail(res, 'Plato no encontrado', [], 404);
  const antes = normalizePlato(plato);
  const allowed = ['codigo', 'nombre', 'descripcion', 'precio', 'tiempo_preparacion', 'disponible', 'activo', 'factus_tax_code', 'factus_tax_rate', 'factus_is_excluded', 'factus_unit_measure_code', 'factus_standard_code'];
  const changes = {};
  allowed.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) changes[field] = req.body[field];
  });
  if (Object.prototype.hasOwnProperty.call(req.body, 'imagen')) {
    changes.imagen = assertLocalAssetPath(req.body.imagen);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'CategoriaId')) {
    const categoriaId = Number(req.body.CategoriaId);
    const categoria = await Categoria.findOne({ where: { id: categoriaId, activo: true } });
    if (!categoria) return fail(res, 'La categoría seleccionada no existe o está inactiva', [], 422);
    changes[categoriaForeignKey] = categoria.id;
  }

  await plato.update(changes);
  const actualizado = await Plato.findByPk(plato.id, { include: [categoriaInclude] });
  await audit({ req, accion: 'EDITAR', modulo: 'platos', registroId: plato.id, antes, despues: normalizePlato(actualizado) });
  return ok(res, 'Plato actualizado', normalizePlato(actualizado));
};

exports.listCategorias = async (req, res) => ok(res, 'Categorías', await Categoria.findAll({ order: [['nombre', 'ASC']] }));

exports.createCategoria = async (req, res) => {
  const categoria = await Categoria.create({ nombre: req.body.nombre, activo: true });
  await audit({ req, accion: 'CREAR', modulo: 'categorias', registroId: categoria.id, despues: categoria.toJSON() });
  return ok(res, 'Categoría creada', categoria, 201);
};

exports.createReserva = async (req, res) => {
  const { cliente, MesaId, MeseroId, personas, fecha, hora, observaciones } = req.body;
  const reservationDate = new Date(`${fecha}T${String(hora).slice(0, 5)}:00`);
  if (Number.isNaN(reservationDate.getTime()) || reservationDate < new Date()) {
    return fail(res, 'No se permiten fechas anteriores', [], 422);
  }

  const transaction = await sequelize.transaction();
  try {
    const mesa = await Mesa.findByPk(MesaId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!mesa || !mesa.activo || ['ocupada', 'limpieza', 'fuera_servicio'].includes(mesa.estado)) {
      throw Object.assign(new Error('Mesa no disponible'), { status: 409 });
    }
    if (Number(personas) > Number(mesa.capacidad)) {
      throw Object.assign(new Error('La reserva supera la capacidad de la mesa'), { status: 422 });
    }

    if (MeseroId) {
      const waiter = await Mesero.findOne({ where: { id: MeseroId, activo: true }, transaction });
      if (!waiter) throw Object.assign(new Error('El mesero seleccionado no está disponible'), { status: 422 });
    }

    const conflicto = await Reserva.findOne({
      where: {
        MesaId,
        fecha,
        hora,
        estado: { [Op.notIn]: ['cancelada', 'completada', 'no_asistio'] },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (conflicto) throw Object.assign(new Error('Ya existe una reserva para esa mesa y horario'), { status: 409 });

    let customer = null;
    if (cliente.documento) customer = await Cliente.findOne({ where: { documento: cliente.documento }, transaction, lock: transaction.LOCK.UPDATE });
    if (!customer) {
      customer = await Cliente.create({
        nombre: cliente.nombre,
        documento: cliente.documento || null,
        telefono: cliente.telefono,
        correo: cliente.correo || null,
      }, { transaction });
    } else {
      await customer.update({
        nombre: cliente.nombre,
        telefono: cliente.telefono,
        correo: cliente.correo || customer.correo,
      }, { transaction });
    }

    const reserva = await Reserva.create({
      codigo: `RES-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ClienteId: customer.id,
      MesaId,
      MeseroId: MeseroId || null,
      personas,
      fecha,
      hora,
      observaciones,
      creado_por: req.user.id,
    }, { transaction });

    await mesa.update({ estado: 'reservada' }, { transaction });
    await transaction.commit();
    await audit({ req, accion: 'CREAR', modulo: 'reservas', registroId: reserva.id, despues: reserva.toJSON() });
    return ok(res, 'Reserva creada', reserva, 201);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.listReservas = async (req, res) => {
  const where = {};
  if (req.query.fecha) where.fecha = req.query.fecha;
  if (req.query.estado) where.estado = req.query.estado;

  if (req.user.rol === 'mesero') {
    const waiter = await Mesero.findOne({ where: { UsuarioId: req.user.id, activo: true } });
    if (!waiter) return ok(res, 'Reservas', []);
    where.MeseroId = waiter.id;
  }

  const reservas = await Reserva.findAll({
    where,
    include: [
      { model: Cliente, attributes: req.user.rol === 'mesero' ? ['id', 'nombre'] : undefined },
      Mesa,
      { model: Mesero, include: [{ model: Usuario, attributes: ['id', 'nombre', 'usuario'] }] },
    ],
    order: [['fecha', 'DESC'], ['hora', 'ASC']],
  });
  return ok(res, 'Reservas', reservas);
};

exports.arrival = async (req, res) => {
  const reserva = await Reserva.findByPk(req.params.id, { include: Mesa });
  if (!reserva) return fail(res, 'Reserva no encontrada', [], 404);
  if (!['pendiente', 'confirmada'].includes(reserva.estado)) return fail(res, 'La reserva no admite confirmar llegada', [], 409);
  await reserva.update({ estado: 'cliente_presente' });
  await reserva.Mesa.update({ estado: 'ocupada' });
  await audit({ req, accion: 'CLIENTE_PRESENTE', modulo: 'reservas', registroId: reserva.id, despues: reserva.toJSON() });
  return ok(res, 'Llegada confirmada', reserva);
};

exports.cancelReserva = async (req, res) => {
  if (!req.body.motivo) return fail(res, 'Debe indicar un motivo', [], 422);
  const reserva = await Reserva.findByPk(req.params.id, { include: Mesa });
  if (!reserva) return fail(res, 'Reserva no encontrada', [], 404);
  if (!activeReservationStates.includes(reserva.estado)) return fail(res, 'La reserva no puede cancelarse', [], 409);

  await reserva.update({ estado: 'cancelada', motivo_cancelacion: req.body.motivo });
  if (reserva.Mesa.estado === 'reservada') await reserva.Mesa.update({ estado: 'disponible' });
  await audit({ req, accion: 'CANCELAR', modulo: 'reservas', registroId: reserva.id, despues: reserva.toJSON() });
  return ok(res, 'Reserva cancelada', reserva);
};


exports.completeReserva = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const reserva = await Reserva.findByPk(req.params.id, {
      include: Mesa,
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!reserva) throw Object.assign(new Error('Reserva no encontrada'), { status: 404 });
    if (reserva.estado !== 'cliente_presente') {
      throw Object.assign(new Error('Solo se puede terminar una reserva con el cliente presente'), { status: 409 });
    }

    const cuentaPendiente = await Pedido.findOne({
      where: {
        [Op.or]: [
          { ReservaId: reserva.id },
          { MesaId: reserva.MesaId },
        ],
        estado_pago: { [Op.ne]: 'pagado' },
        estado: { [Op.notIn]: ['cancelado', 'rechazado'] },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (cuentaPendiente) {
      throw Object.assign(new Error('No se puede terminar la reserva porque la mesa tiene una cuenta pendiente'), { status: 409 });
    }

    const antes = reserva.toJSON();
    await reserva.update({ estado: 'completada' }, { transaction });

    if (reserva.Mesa && !['fuera_servicio'].includes(reserva.Mesa.estado)) {
      await reserva.Mesa.update({ estado: 'limpieza' }, { transaction });
    }

    await transaction.commit();
    await audit({
      req,
      accion: 'COMPLETAR',
      modulo: 'reservas',
      registroId: reserva.id,
      antes,
      despues: reserva.toJSON(),
    });
    return ok(res, 'Reserva terminada. La mesa quedó en limpieza', reserva);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.createPedido = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { MesaId, ReservaId, ClienteId, MeseroId, items, notas_cocina } = req.body;
    if (!Array.isArray(items) || !items.length) throw Object.assign(new Error('El pedido no puede estar vacío'), { status: 422 });

    const mesa = await Mesa.findByPk(MesaId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!mesa || mesa.estado !== 'ocupada') throw Object.assign(new Error('La mesa debe estar ocupada'), { status: 409 });

    const activeOrder = await Pedido.findOne({
      where: {
        MesaId,
        estado: { [Op.in]: openOrderStates },
        estado_pago: { [Op.ne]: 'pagado' },
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (activeOrder) throw Object.assign(new Error('La mesa ya tiene un pedido activo. Usa la opción Agregar adicional.'), { status: 409 });

    let waiter = null;
    if (req.user.rol === 'mesero') {
      waiter = await Mesero.findOne({ where: { UsuarioId: req.user.id, activo: true }, transaction });
      if (!waiter) throw Object.assign(new Error('El usuario no tiene un perfil de mesero activo'), { status: 409 });
      if (mesa.MeseroId && Number(mesa.MeseroId) !== Number(waiter.id)) {
        throw Object.assign(new Error('La mesa está asignada a otro mesero'), { status: 403 });
      }
      if (!mesa.MeseroId) await mesa.update({ MeseroId: waiter.id }, { transaction });
    } else {
      waiter = await Mesero.findOne({ where: { id: MeseroId, activo: true }, transaction });
      if (!waiter) throw Object.assign(new Error('Debe seleccionar un mesero activo'), { status: 422 });
    }

    let reservation = null;
    if (ReservaId) {
      reservation = await Reserva.findOne({
        where: { id: ReservaId, MesaId, estado: 'cliente_presente' },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!reservation) throw Object.assign(new Error('La reserva no corresponde a esta mesa o no tiene al cliente presente'), { status: 409 });
    }

    const resolvedClientId = reservation?.ClienteId || ClienteId || null;
    if (resolvedClientId) {
      const customer = await Cliente.findByPk(resolvedClientId, { transaction });
      if (!customer) throw Object.assign(new Error('Cliente inválido'), { status: 422 });
    }

    const ids = items.map((item) => Number(item.PlatoId));
    const platos = await Plato.findAll({ where: { id: ids, activo: true, disponible: true }, transaction });
    if (platos.length !== new Set(ids).size) throw Object.assign(new Error('Uno o más platos no están disponibles'), { status: 409 });

    let subtotal = 0;
    let impuestos = 0;
    const normalized = items.map((item) => {
      const plato = platos.find((row) => row.id === Number(item.PlatoId));
      const cantidad = Number(item.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) throw Object.assign(new Error('Cantidad inválida'), { status: 422 });
      const itemSubtotal = Math.round(num(plato.precio) * cantidad * 100) / 100;
      const taxRate = plato.factus_is_excluded ? 0 : num(plato.factus_tax_rate ?? process.env.FACTUS_DEFAULT_TAX_RATE ?? 19);
      const taxValue = Math.round(itemSubtotal * taxRate) / 100;
      subtotal += itemSubtotal;
      impuestos += taxValue;
      return {
        PlatoId: plato.id,
        cantidad,
        precio_unitario: plato.precio,
        subtotal: itemSubtotal,
        impuesto_codigo: plato.factus_tax_code || process.env.FACTUS_DEFAULT_TAX_CODE || '01',
        impuesto_tasa: taxRate,
        impuesto_valor: taxValue,
        impuesto_excluido: Boolean(plato.factus_is_excluded),
        unidad_medida_codigo: plato.factus_unit_measure_code || '94',
        codigo_estandar: plato.factus_standard_code || '999',
        observaciones: item.observaciones || null,
      };
    });
    subtotal = Math.round(subtotal * 100) / 100;
    impuestos = Math.round(impuestos * 100) / 100;
    const pedido = await Pedido.create({
      numero: `PED-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      MesaId,
      ReservaId: reservation?.id || null,
      ClienteId: resolvedClientId,
      MeseroId: waiter.id,
      creado_por: req.user.id,
      subtotal,
      impuestos,
      propina: 0,
      propina_porcentaje: 0,
      total: subtotal + impuestos,
      notas_cocina,
      estado: 'enviado_despacho',
    }, { transaction });

    await DetallePedido.bulkCreate(normalized.map((item) => ({ ...item, PedidoId: pedido.id })), { transaction });
    await HistorialPedido.create({ PedidoId: pedido.id, UsuarioId: req.user.id, estado_nuevo: 'enviado_despacho' }, { transaction });
    await transaction.commit();

    req.app.get('io').emit('pedido:actualizado', { id: pedido.id, estado: pedido.estado });
    await audit({ req, accion: 'CREAR', modulo: 'pedidos', registroId: pedido.id, despues: pedido.toJSON() });
    return ok(res, 'Pedido enviado a despacho', pedido, 201);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.listPedidos = async (req, res) => {
  const where = {};
  if (req.query.mesa) where.MesaId = req.query.mesa;

  let waiter = null;
  if (req.user.rol === 'mesero') {
    waiter = await Mesero.findOne({ where: { UsuarioId: req.user.id, activo: true } });
    if (!waiter) return ok(res, 'Pedidos', []);
    where.MeseroId = waiter.id;
  }

  if (req.user.rol === 'cocina') {
    const kitchenStates = ['enviado_cocina', 'en_preparacion', 'listo'];
    where.estado = req.query.estado && kitchenStates.includes(req.query.estado)
      ? req.query.estado
      : { [Op.in]: kitchenStates };
  } else if (req.query.estado) {
    where.estado = req.query.estado;
  }

  if (req.query.fecha) {
    const fecha = String(req.query.fecha);
    const inicio = new Date(`${fecha}T00:00:00`);
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + 1);
    where.created_at = { [Op.gte]: inicio, [Op.lt]: fin };
  }

  const includes = [
    Mesa,
    { model: Mesero, include: [{ model: Usuario, attributes: ['id', 'nombre', 'usuario'] }] },
    { model: DetallePedido, as: 'detalles', include: [{ model: Plato, attributes: ['id', 'codigo', 'nombre', 'tiempo_preparacion'] }] },
  ];

  if (req.user.rol === 'administrador' || req.user.rol === 'despacho') {
    includes.push(
      Cliente,
      Reserva,
      { model: Factura, attributes: { exclude: ['respuesta_proveedor', 'errores_proveedor'] } },
      { model: Pago, include: MetodoPago },
    );
  } else if (req.user.rol === 'mesero') {
    includes.push(
      { model: Cliente, attributes: ['id', 'nombre'] },
      Reserva,
      { model: Factura, attributes: ['id', 'numero', 'proveedor', 'estado_electronico', 'createdAt'] },
    );
  }

  const pedidos = await Pedido.findAll({
    where,
    include: includes,
    order: [['created_at', 'ASC']],
  });
  return ok(res, 'Pedidos', pedidos);
};

exports.addPedidoItems = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const pedido = await Pedido.findByPk(req.params.id, {
      include: [{ model: Mesero, include: Usuario }],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!pedido) throw Object.assign(new Error('Pedido no encontrado'), { status: 404 });
    if (pedido.estado_pago === 'pagado' || ['pagado', 'cancelado', 'rechazado'].includes(pedido.estado)) {
      throw Object.assign(new Error('No se pueden agregar adicionales a un pedido cerrado'), { status: 409 });
    }

    if (req.user.rol === 'mesero' && pedido.Mesero?.UsuarioId !== req.user.id) {
      throw Object.assign(new Error('Solo puedes modificar los pedidos asignados a tu usuario'), { status: 403 });
    }

    const items = req.body.items;
    if (!Array.isArray(items) || !items.length) {
      throw Object.assign(new Error('Debes agregar al menos un plato adicional'), { status: 422 });
    }

    const ids = items.map((item) => Number(item.PlatoId));
    const platos = await Plato.findAll({
      where: { id: ids, activo: true, disponible: true },
      transaction,
    });
    if (platos.length !== new Set(ids).size) {
      throw Object.assign(new Error('Uno o más platos adicionales no están disponibles'), { status: 409 });
    }

    let subtotalAdicional = 0;
    let impuestoAdicional = 0;
    const detalles = items.map((item) => {
      const plato = platos.find((row) => row.id === Number(item.PlatoId));
      const cantidad = Number(item.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        throw Object.assign(new Error('Cantidad inválida en los adicionales'), { status: 422 });
      }
      const subtotal = Math.round(num(plato.precio) * cantidad * 100) / 100;
      const taxRate = plato.factus_is_excluded ? 0 : num(plato.factus_tax_rate ?? process.env.FACTUS_DEFAULT_TAX_RATE ?? 19);
      const taxValue = Math.round(subtotal * taxRate) / 100;
      subtotalAdicional += subtotal;
      impuestoAdicional += taxValue;
      return {
        PedidoId: pedido.id,
        PlatoId: plato.id,
        cantidad,
        precio_unitario: plato.precio,
        subtotal,
        impuesto_codigo: plato.factus_tax_code || process.env.FACTUS_DEFAULT_TAX_CODE || '01',
        impuesto_tasa: taxRate,
        impuesto_valor: taxValue,
        impuesto_excluido: Boolean(plato.factus_is_excluded),
        unidad_medida_codigo: plato.factus_unit_measure_code || '94',
        codigo_estandar: plato.factus_standard_code || '999',
        observaciones: item.observaciones || null,
        estado: 'pendiente',
      };
    });

    await DetallePedido.bulkCreate(detalles, { transaction });

    subtotalAdicional = Math.round(subtotalAdicional * 100) / 100;
    impuestoAdicional = Math.round(impuestoAdicional * 100) / 100;
    const subtotalAnterior = num(pedido.subtotal);
    const impuestoAnterior = num(pedido.impuestos);
    const nuevoSubtotal = Math.round((subtotalAnterior + subtotalAdicional) * 100) / 100;
    const nuevosImpuestos = Math.round((impuestoAnterior + impuestoAdicional) * 100) / 100;
    const nuevoTotal = Math.round((nuevoSubtotal + nuevosImpuestos - num(pedido.descuento) + num(pedido.propina)) * 100) / 100;
    const estadoAnterior = pedido.estado;

    await pedido.update({
      subtotal: nuevoSubtotal,
      impuestos: nuevosImpuestos,
      total: nuevoTotal,
      estado: 'enviado_despacho',
    }, { transaction });

    const resumen = detalles.map((item) => {
      const plato = platos.find((row) => row.id === item.PlatoId);
      return `${item.cantidad} x ${plato?.nombre || 'Plato'}`;
    }).join(', ');

    await HistorialPedido.create({
      PedidoId: pedido.id,
      UsuarioId: req.user.id,
      estado_anterior: estadoAnterior,
      estado_nuevo: 'enviado_despacho',
      observacion: `Adicional agregado: ${resumen}`,
    }, { transaction });

    await transaction.commit();

    req.app.get('io').emit('pedido:actualizado', {
      id: pedido.id,
      estado: pedido.estado,
      adicionales: true,
    });

    await audit({
      req,
      accion: 'AGREGAR_ADICIONALES',
      modulo: 'pedidos',
      registroId: pedido.id,
      antes: { subtotal: subtotalAnterior, estado: estadoAnterior },
      despues: {
        subtotal: nuevoSubtotal,
        impuestos: nuevosImpuestos,
        total: nuevoTotal,
        estado: 'enviado_despacho',
        items: detalles,
      },
    });

    return ok(res, 'Adicionales agregados y enviados a despacho', {
      pedido,
      subtotal_adicional: subtotalAdicional,
    });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.changePedidoStatus = async (req, res) => {
  const pedido = await Pedido.findByPk(req.params.id, {
    include: [{ model: Mesero, include: Usuario }, Mesa],
  });
  if (!pedido) return fail(res, 'Pedido no encontrado', [], 404);

  const target = req.body.estado;
  const allowed = {
    despacho: ['confirmado_despacho', 'enviado_cocina', 'rechazado', 'en_entrega'],
    cocina: ['en_preparacion', 'listo'],
    administrador: ['confirmado_despacho', 'enviado_cocina', 'en_preparacion', 'listo', 'en_entrega', 'entregado', 'cancelado', 'rechazado'],
    mesero: ['entregado', 'cancelado'],
  };
  if (!allowed[req.user.rol]?.includes(target)) return fail(res, 'Cambio de estado no autorizado', [], 403);

  const transitions = {
    despacho: {
      enviado_despacho: ['confirmado_despacho', 'rechazado'],
      confirmado_despacho: ['enviado_cocina', 'rechazado'],
      listo: ['en_entrega'],
    },
    cocina: {
      enviado_cocina: ['en_preparacion'],
      en_preparacion: ['listo'],
    },
    mesero: {
      en_entrega: ['entregado'],
      enviado_despacho: ['cancelado'],
      confirmado_despacho: ['cancelado'],
    },
  };

  if (req.user.rol !== 'administrador' && !transitions[req.user.rol]?.[pedido.estado]?.includes(target)) {
    return fail(res, `No se puede cambiar de ${pedido.estado} a ${target}`, [], 409);
  }

  if (req.user.rol === 'mesero') {
    if (!pedido.Mesero || pedido.Mesero.UsuarioId !== req.user.id) {
      return fail(res, 'Solo puedes actualizar los pedidos asignados a tu usuario', [], 403);
    }
  }

  if (['rechazado', 'cancelado'].includes(target) && !req.body.observacion) return fail(res, 'Debe indicar el motivo', [], 422);
  if (pedido.estado_pago === 'pagado' && ['cancelado', 'rechazado'].includes(target)) return fail(res, 'No se puede cancelar un pedido pagado', [], 409);

  if (target === 'listo') {
    const pendientes = await DetallePedido.count({
      where: { PedidoId: pedido.id, estado: { [Op.notIn]: ['preparado', 'cancelado', 'no_disponible'] } },
    });
    if (pendientes > 0) return fail(res, 'Todos los platos deben estar preparados antes de marcar el pedido como listo', [], 409);
  }

  const anterior = pedido.estado;
  await pedido.update({ estado: target });
  await HistorialPedido.create({
    PedidoId: pedido.id,
    UsuarioId: req.user.id,
    estado_anterior: anterior,
    estado_nuevo: pedido.estado,
    observacion: req.body.observacion || null,
  });

  let notification = null;
  if (target === 'en_entrega' && pedido.Mesero?.UsuarioId) {
    notification = await Notificacion.create({
      UsuarioId: pedido.Mesero.UsuarioId,
      titulo: 'Pedido verificado y listo para recoger',
      mensaje: `${pedido.numero} de la Mesa ${pedido.Mesa?.numero || '-'} fue revisado por despacho. Recógelo y entrégalo al cliente.`,
      tipo: 'pedido_listo',
      leida: false,
    });
    req.app.get('io').to(`usuario:${pedido.Mesero.UsuarioId}`).emit('notificacion:nueva', notification.toJSON());
  }

  await audit({
    req,
    accion: target === 'en_entrega' ? 'VERIFICAR_Y_AVISAR_MESERO' : 'CAMBIO_ESTADO',
    modulo: 'pedidos',
    registroId: pedido.id,
    antes: { estado: anterior },
    despues: { estado: pedido.estado, notificacion_id: notification?.id || null },
  });
  req.app.get('io').emit('pedido:actualizado', { id: pedido.id, estado: pedido.estado });
  return ok(res, target === 'en_entrega' ? 'Pedido verificado. El mesero fue notificado' : 'Estado actualizado', pedido);
};

exports.changeDetailStatus = async (req, res) => {
  const detail = await DetallePedido.findByPk(req.params.id, { include: Pedido });
  if (!detail) return fail(res, 'Detalle no encontrado', [], 404);

  if (req.user.rol === 'cocina' && !['enviado_cocina', 'en_preparacion'].includes(detail.Pedido.estado)) {
    return fail(res, 'El pedido no se encuentra disponible para cocina', [], 409);
  }

  const target = req.body.estado;
  const transitions = {
    pendiente: ['preparando', 'preparado', 'no_disponible', 'cancelado'],
    preparando: ['preparado', 'no_disponible', 'cancelado'],
    preparado: [],
    no_disponible: [],
    cancelado: [],
  };
  if (req.user.rol !== 'administrador' && !transitions[detail.estado]?.includes(target)) {
    return fail(res, `No se puede cambiar el plato de ${detail.estado} a ${target}`, [], 409);
  }
  if (target === 'no_disponible' && !req.body.observacion) return fail(res, 'Indique el motivo de no disponibilidad', [], 422);

  const anterior = detail.toJSON();
  await detail.update({ estado: target, observaciones: req.body.observacion || detail.observaciones });
  if (target === 'no_disponible') {
    const plato = await Plato.findByPk(detail.PlatoId);
    if (plato) await plato.update({ disponible: false });
  }

  await audit({
    req,
    accion: 'CAMBIO_ESTADO_PLATO',
    modulo: 'cocina',
    registroId: detail.id,
    antes: { estado: anterior.estado },
    despues: { estado: detail.estado, pedido_id: detail.PedidoId },
  });
  req.app.get('io').emit('pedido:actualizado', { id: detail.PedidoId, estado: detail.Pedido.estado });
  return ok(res, 'Estado del plato actualizado', detail);
};

exports.listPaymentMethods = async (req, res) => ok(res, 'Métodos de pago', await MetodoPago.findAll({ where: { activo: true }, order: [['nombre', 'ASC']] }));

exports.factusStatus = async (req, res) => {
  const current = factus.status();
  return ok(res, 'Estado de Factus', {
    enabled: current.enabled,
    configured: current.configured,
    environment: current.environment,
    numbering_range_id: current.numbering_range_id,
    mock_mode: current.mock_mode,
    missing: current.missing,
  });
};

exports.factusRanges = async (req, res) => {
  const ranges = await factus.listNumberingRanges();
  return ok(res, 'Rangos de numeración Factus', ranges?.data || ranges);
};

exports.pay = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const pedido = await Pedido.findByPk(req.params.id, {
      include: [
        Mesa,
        Cliente,
        { model: DetallePedido, as: 'detalles', include: [Plato] },
        Factura,
      ],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!pedido || ['cancelado', 'rechazado'].includes(pedido.estado)) throw Object.assign(new Error('Pedido no pagable'), { status: 409 });
    if (!['entregado', 'en_entrega'].includes(pedido.estado)) throw Object.assign(new Error('El pedido debe estar entregado antes de registrar el pago'), { status: 409 });
    if (pedido.estado_pago === 'pagado') throw Object.assign(new Error('Pedido ya pagado'), { status: 409 });
    if (pedido.Factura) throw Object.assign(new Error('El pedido ya tiene una factura registrada. Revisa el historial antes de volver a cobrar'), { status: 409 });

    const metodo = await MetodoPago.findByPk(req.body.MetodoPagoId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!metodo || !metodo.activo) throw Object.assign(new Error('Método de pago inválido'), { status: 422 });

    // El backend calcula IVA, propina y total. Nunca confía en totales enviados desde el navegador.
    const incluirPropina = req.body.incluir_propina === true;
    const billTotals = calculateBillTotals(pedido, incluirPropina);
    const consumoTotal = billTotals.consumption;
    const propina = billTotals.tip;
    const total = billTotals.total;
    const recibido = roundMoney(req.body.valor);
    const nombreMetodo = String(metodo.nombre || '').toLowerCase();
    const esEfectivo = nombreMetodo.includes('efectivo');
    const esMixto = nombreMetodo.includes('mixto');
    const referencia = String(req.body.referencia || '').trim();
    const emitirFactus = req.body.emitir_factus === true;
    const enviarEmail = req.body.enviar_email === true;
    const factusState = factus.status();
    const mockFactus = emitirFactus && factusState.mock_mode;

    if (esEfectivo && recibido < total) throw Object.assign(new Error('Valor recibido insuficiente'), { status: 422 });
    if (!esEfectivo && Math.abs(recibido - total) > 0.009) {
      throw Object.assign(new Error('En pagos no realizados en efectivo, el valor debe coincidir exactamente con el total'), { status: 422 });
    }
    if (!esEfectivo && referencia.length < 3) {
      throw Object.assign(new Error('Debe registrar la referencia o comprobante del pago'), { status: 422 });
    }
    if (emitirFactus && esMixto) {
      throw Object.assign(new Error('La factura todavía no admite pago mixto real. Selecciona un único medio de pago'), { status: 422 });
    }

    const factusPaymentCode = factus.paymentMethodCode(metodo.nombre, req.body.factus_payment_method_code);
    const externalReference = `RR-${pedido.numero}-${pedido.id}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
    let factusResult = null;
    let remoteInvoice = null;

    if (emitirFactus) {
      const payload = factus.buildInvoicePayload({
        pedido,
        pago: {
          referencia: esEfectivo ? null : referencia,
          factus_payment_method_code: factusPaymentCode,
        },
        metodo,
        customerInput: req.body.factus_customer || {},
        sendEmail: mockFactus ? false : enviarEmail,
        referenceCode: externalReference,
      });
      factusResult = await factus.createAndValidateInvoice(payload);
      remoteInvoice = factusResult.data || {};
      const confirmed = mockFactus
        ? remoteInvoice.is_mock === true
        : (remoteInvoice.is_validated === true || Boolean(remoteInvoice.cufe));
      if (!remoteInvoice.number || !confirmed) {
        throw Object.assign(new Error(mockFactus
          ? 'No fue posible generar la factura simulada'
          : 'Factus no confirmó la validación de la factura ante la DIAN'), {
          status: 502,
          code: mockFactus ? 'FACTUS_MOCK_FAILED' : 'FACTUS_NOT_VALIDATED',
        });
      }
    }

    const pago = await Pago.create({
      PedidoId: pedido.id,
      MetodoPagoId: metodo.id,
      UsuarioId: req.user.id,
      valor: total,
      recibido,
      cambio: esEfectivo ? roundMoney(recibido - total) : 0,
      referencia: esEfectivo ? null : referencia,
      factus_payment_method_code: emitirFactus ? factusPaymentCode : null,
    }, { transaction });

    const links = remoteInvoice?.links || {};
    const providerValidatedAt = remoteInvoice?.validated_at || remoteInvoice?.validatedAt || null;
    const parsedValidatedAt = providerValidatedAt && !Number.isNaN(new Date(providerValidatedAt).getTime())
      ? new Date(providerValidatedAt)
      : (emitirFactus ? new Date() : null);
    const factura = await Factura.create({
      PedidoId: pedido.id,
      numero: emitirFactus ? String(remoteInvoice.number) : `FAC-${Date.now()}-${pedido.id}`,
      subtotal: pedido.subtotal,
      impuestos: pedido.impuestos,
      descuento: pedido.descuento,
      propina,
      total,
      proveedor: mockFactus ? 'factus_mock' : (emitirFactus ? 'factus' : 'local'),
      estado_electronico: mockFactus ? 'simulada' : (emitirFactus ? 'validada' : 'no_solicitada'),
      referencia_externa: emitirFactus ? externalReference : null,
      cufe: remoteInvoice?.cufe || null,
      url_publica: mockFactus ? null : (links.public_url || remoteInvoice?.public_url || null),
      url_qr: mockFactus ? null : (links.qr || remoteInvoice?.qr || null),
      validada_en: parsedValidatedAt,
      enviada_email: !mockFactus && emitirFactus && enviarEmail,
      errores_proveedor: null,
      respuesta_proveedor: emitirFactus ? factus.storageSnapshot(factusResult.raw) : null,
    }, { transaction });

    if (emitirFactus && req.body.factus_customer?.consumidor_final === false && pedido.Cliente) {
      const customer = req.body.factus_customer;
      await pedido.Cliente.update({
        documento: String(customer.identification || pedido.Cliente.documento || '').replace(/\D/g, '') || null,
        nombre: customer.names || customer.company || pedido.Cliente.nombre,
        correo: customer.email || pedido.Cliente.correo || null,
        telefono: customer.phone || pedido.Cliente.telefono,
        tipo_documento_codigo: customer.identification_document_code || '13',
        organizacion_legal_codigo: customer.legal_organization_code || '2',
        tributo_codigo: customer.tribute_code || 'ZZ',
        razon_social: customer.company || null,
        nombre_comercial: customer.trade_name || null,
        digito_verificacion: customer.dv || null,
        direccion: customer.address || null,
        pais_codigo: customer.country_code || 'CO',
        municipio_codigo: customer.municipality_code || null,
      }, { transaction });
    }

    await pedido.update({
      propina,
      propina_porcentaje: billTotals.tipRate,
      total,
      estado: 'pagado',
      estado_pago: 'pagado',
    }, { transaction });
    const mesa = await Mesa.findByPk(pedido.MesaId, { transaction, lock: transaction.LOCK.UPDATE });
    if (mesa) await mesa.update({ estado: 'limpieza' }, { transaction });
    await transaction.commit();

    req.app.get('io').emit('pedido:actualizado', { id: pedido.id, estado: 'pagado' });
    await audit({
      req,
      accion: mockFactus ? 'PAGO_Y_FACTURA_SIMULADA' : (emitirFactus ? 'PAGO_Y_FACTURA_ELECTRONICA' : 'PAGO'),
      modulo: 'pagos',
      registroId: pago.id,
      despues: {
        pedido_id: pedido.id,
        metodo: metodo.nombre,
        consumo: consumoTotal,
        iva: num(pedido.impuestos),
        propina,
        valor: total,
        factura: factura.numero,
        proveedor: factura.proveedor,
        cufe: factura.cufe || null,
      },
    });
    const facturaPublica = factura.toJSON();
    delete facturaPublica.respuesta_proveedor;
    delete facturaPublica.errores_proveedor;
    const message = mockFactus
      ? 'Pago registrado y factura simulada generada'
      : (emitirFactus ? 'Pago registrado y factura electrónica validada' : 'Pago registrado');
    return ok(res, message, { pago, factura: facturaPublica, resumen: { consumo: consumoTotal, iva: num(pedido.impuestos), propina, total } });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    if (error.code && String(error.code).startsWith('FACTUS')) {
      try {
        await audit({
          req,
          accion: 'FACTURACION_FALLIDA',
          modulo: 'facturacion',
          registroId: String(req.params.id),
          despues: { codigo: error.code, estado_proveedor: error.providerStatus || null, mensaje: error.message },
        });
      } catch (_) {
        // Conserva el error original aunque la auditoría no esté disponible.
      }
    }
    throw error;
  }
};

exports.downloadFactusInvoice = async (req, res) => {
  const type = String(req.params.type || '').toLowerCase();
  if (!['pdf', 'xml'].includes(type)) return fail(res, 'Tipo de archivo no permitido', [], 422);
  const factura = await Factura.findByPk(req.params.id);
  if (!factura) return fail(res, 'Factura no encontrada', [], 404);
  if (factura.proveedor !== 'factus' || factura.estado_electronico !== 'validada') {
    return fail(res, 'La factura seleccionada no es una factura electrónica validada por Factus', [], 409);
  }

  const file = await factus.download(factura.numero, type);
  const safeFilename = String(file.filename || `${factura.numero}.${type}`).replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Type', type === 'pdf' ? 'application/pdf' : 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Length', String(file.buffer.length));
  return res.end(file.buffer);
};

exports.sendFactusInvoiceEmail = async (req, res) => {
  const factura = await Factura.findByPk(req.params.id, { include: [{ model: Pedido, include: [Cliente] }] });
  if (!factura) return fail(res, 'Factura no encontrada', [], 404);
  if (factura.proveedor !== 'factus' || factura.estado_electronico !== 'validada') {
    return fail(res, 'Solo se pueden enviar facturas electrónicas validadas', [], 409);
  }
  const email = String(req.body.email || factura.Pedido?.Cliente?.correo || '').trim().toLowerCase();
  if (!email) return fail(res, 'Registra un correo para enviar la factura', [], 422);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    return fail(res, 'El correo registrado no es válido', [], 422);
  }
  await factus.sendInvoiceEmail(factura.numero, email);
  await factura.update({ enviada_email: true });
  await audit({ req, accion: 'ENVIAR_FACTURA_EMAIL', modulo: 'facturacion', registroId: factura.id, despues: { numero: factura.numero, email } });
  return ok(res, 'Factura enviada al correo', { email, factura_id: factura.id });
};

exports.listNotifications = async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const notifications = await Notificacion.findAll({
    where: { UsuarioId: req.user.id },
    order: [['createdAt', 'DESC']],
    limit,
  });
  const noLeidas = await Notificacion.count({ where: { UsuarioId: req.user.id, leida: false } });
  return ok(res, 'Notificaciones', { notificaciones: notifications, no_leidas: noLeidas });
};

exports.markNotificationRead = async (req, res) => {
  const notification = await Notificacion.findOne({ where: { id: req.params.id, UsuarioId: req.user.id } });
  if (!notification) return fail(res, 'Notificación no encontrada', [], 404);
  await notification.update({ leida: true });
  return ok(res, 'Notificación marcada como leída', notification);
};

exports.markAllNotificationsRead = async (req, res) => {
  await Notificacion.update({ leida: true }, { where: { UsuarioId: req.user.id, leida: false } });
  return ok(res, 'Todas las notificaciones fueron marcadas como leídas', {});
};

exports.listUsuarios = async (req, res) => {
  const usuarios = await Usuario.findAll({
    attributes: { exclude: ['password_hash'] },
    include: [Role, Mesero],
    order: [['nombre', 'ASC']],
  });
  return ok(res, 'Usuarios', usuarios);
};

exports.createUsuario = async (req, res) => {
  const role = await Role.findOne({ where: { nombre: req.body.rol } });
  if (!role) return fail(res, 'Rol no válido', [], 422);

  const transaction = await sequelize.transaction();
  try {
    const usuario = await Usuario.create(
      {
        nombre: req.body.nombre,
        usuario: req.body.usuario,
        correo: req.body.correo,
        password_hash: await bcrypt.hash(req.body.password, 12),
        RoleId: role.id,
        activo: true,
        debe_cambiar_password: true,
      },
      { transaction },
    );
    if (role.nombre === 'mesero') {
      await Mesero.create({ UsuarioId: usuario.id, codigo: req.body.codigo || `MES-${String(usuario.id).padStart(3, '0')}`, activo: true }, { transaction });
    }
    await transaction.commit();
    await audit({ req, accion: 'CREAR', modulo: 'usuarios', registroId: usuario.id, despues: { nombre: usuario.nombre, usuario: usuario.usuario, rol: role.nombre } });
    return ok(res, 'Usuario creado', { id: usuario.id, nombre: usuario.nombre, usuario: usuario.usuario, rol: role.nombre }, 201);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.toggleUsuario = async (req, res) => {
  const usuario = await Usuario.findByPk(req.params.id, { include: [Role, Mesero] });
  if (!usuario) return fail(res, 'Usuario no encontrado', [], 404);
  if (usuario.id === req.user.id && req.body.activo === false) return fail(res, 'No puede desactivar su propio usuario', [], 409);

  const activo = Boolean(req.body.activo);
  await usuario.update({ activo });
  if (usuario.Mesero) await usuario.Mesero.update({ activo });
  await audit({ req, accion: activo ? 'ACTIVAR' : 'DESACTIVAR', modulo: 'usuarios', registroId: usuario.id, despues: { activo } });
  return ok(res, activo ? 'Usuario activado' : 'Usuario desactivado', usuario);
};

exports.resetOperationalData = async (req, res) => {
  if (process.env.NODE_ENV === 'production') return fail(res, 'El reinicio de datos demo está deshabilitado en producción', [], 403);
  const transaction = await sequelize.transaction();
  try {
    await HistorialPedido.destroy({ where: {}, transaction });
    await DetallePedido.destroy({ where: {}, transaction });
    await Pago.destroy({ where: {}, transaction });
    await Factura.destroy({ where: {}, transaction });
    await Pedido.destroy({ where: {}, transaction });
    await Reserva.destroy({ where: {}, transaction });
    await Cliente.destroy({ where: {}, transaction });
    await Mesa.update({ estado: 'disponible' }, { where: { activo: true }, transaction });
    await transaction.commit();
    await audit({ req, accion: 'REINICIAR_DATOS', modulo: 'sistema', registroId: 'operacion' });
    req.app.get('io').emit('pedido:actualizado', { reset: true });
    return ok(res, 'Datos operativos reiniciados');
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

exports.reportSales = async (req, res) => {
  const desde = req.query.desde ? new Date(`${req.query.desde}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
  const hasta = req.query.hasta ? new Date(`${req.query.hasta}T23:59:59`) : new Date();
  const pagos = await Pago.findAll({
    where: { created_at: { [Op.between]: [desde, hasta] } },
    include: [{ model: MetodoPago }, { model: Pedido, include: [Mesa, { model: Mesero, include: Usuario }, { model: DetallePedido, as: 'detalles', include: Plato }] }],
    order: [['created_at', 'DESC']],
  });

  const porMetodo = {};
  const porPlato = {};
  pagos.forEach((pago) => {
    const method = pago.MetodoPago?.nombre || 'Sin método';
    porMetodo[method] = (porMetodo[method] || 0) + num(pago.valor);
    pago.Pedido?.detalles?.forEach((detail) => {
      const name = detail.Plato?.nombre || 'Plato';
      porPlato[name] = (porPlato[name] || 0) + detail.cantidad;
    });
  });

  const totalCobrado = pagos.reduce((acc, item) => acc + num(item.valor), 0);
  const totalPropinas = pagos.reduce((acc, item) => acc + num(item.Pedido?.propina), 0);
  const ventasSinPropina = totalCobrado - totalPropinas;
  return ok(res, 'Reporte de ventas', {
    desde,
    hasta,
    total: totalCobrado,
    ventas_sin_propina: ventasSinPropina,
    total_propinas: totalPropinas,
    cantidad: pagos.length,
    ticket_promedio: pagos.length ? totalCobrado / pagos.length : 0,
    por_metodo: porMetodo,
    platos: Object.entries(porPlato).sort((a, b) => b[1] - a[1]),
    pagos,
  });
};

exports.auditList = async (req, res) => ok(res, 'Auditoría', await Auditoria.findAll({ order: [['created_at', 'DESC']], limit: 200 }));
