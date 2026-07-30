const router = require('express').Router();
const { body, query } = require('express-validator');
const validate = require('../middlewares/validate');
const { auth, roles } = require('../middlewares/auth');
const V = require('../validators');
const A = require('../controllers/authController');
const C = require('../controllers/coreController');

router.get('/auth/csrf', A.csrf);
router.post('/auth/login', V.login, validate, A.login);
router.get('/auth/me', auth, A.me);
router.post('/auth/logout', auth, A.logout);
router.post('/auth/change-password', auth, V.changePassword, validate, A.changePassword);

router.get('/dashboard', auth, C.dashboard);

router.get('/mesas', auth, [query('todas').optional().isIn(['0', '1'])], validate, C.listMesas);
router.post('/mesas', auth, roles('administrador'), V.mesaCreate, validate, C.createMesa);
router.put('/mesas/:id', auth, roles('administrador'), V.mesaUpdate, validate, C.updateMesa);
router.delete('/mesas/:id', auth, roles('administrador'), V.idParam, validate, C.deleteMesa);
router.post('/mesas/:id/ocupar', auth, roles('administrador', 'mesero'), V.idParam, validate, C.occupyTable);
router.post('/mesas/:id/liberar', auth, roles('administrador', 'mesero'), V.idParam, validate, C.releaseTable);
router.get('/meseros', auth, roles('administrador', 'mesero', 'despacho'), C.listMeseros);

router.get('/catalogo', auth, C.listCatalog);
router.get('/platos', auth, [query('todos').optional().isIn(['0', '1'])], validate, C.listPlatos);
router.post('/platos', auth, roles('administrador'), V.platoCreate, validate, C.createPlato);
router.put('/platos/:id', auth, roles('administrador'), V.platoUpdate, validate, C.updatePlato);
router.get('/categorias', auth, C.listCategorias);
router.post('/categorias', auth, roles('administrador'), [body('nombre').isString().trim().isLength({ min: 2, max: 70 })], validate, C.createCategoria);

router.get('/reservas', auth, roles('administrador', 'mesero', 'despacho'), V.listDateQuery, validate, C.listReservas);
router.post('/reservas', auth, roles('administrador', 'despacho'), V.reservaCreate, validate, C.createReserva);
router.post('/reservas/:id/llegada', auth, roles('administrador', 'despacho'), V.idParam, validate, C.arrival);
router.post('/reservas/:id/cancelar', auth, roles('administrador', 'despacho'), V.motivo, validate, C.cancelReserva);
router.post('/reservas/:id/completar', auth, roles('administrador', 'despacho'), V.idParam, validate, C.completeReserva);

router.get('/pedidos', auth, V.listDateQuery, validate, C.listPedidos);
router.post('/pedidos', auth, roles('administrador', 'mesero'), V.pedidoCreate, validate, C.createPedido);
router.post('/pedidos/:id/items', auth, roles('administrador', 'mesero'), V.pedidoAdditional, validate, C.addPedidoItems);
router.patch('/pedidos/:id/estado', auth, V.pedidoStatus, validate, C.changePedidoStatus);
router.patch('/detalles-pedido/:id/estado', auth, roles('administrador', 'cocina'), V.detailStatus, validate, C.changeDetailStatus);
router.get('/metodos-pago', auth, roles('administrador', 'despacho'), C.listPaymentMethods);
router.get('/facturacion/factus/estado', auth, roles('administrador', 'despacho'), C.factusStatus);
router.get('/facturacion/factus/rangos', auth, roles('administrador'), C.factusRanges);
router.post('/pedidos/:id/pagar', auth, roles('administrador', 'despacho'), V.payment, validate, C.pay);
router.get('/facturas/:id/:type', auth, roles('administrador', 'despacho'), V.factusInvoiceFile, validate, C.downloadFactusInvoice);
router.post('/facturas/:id/enviar-correo', auth, roles('administrador', 'despacho'), V.factusEmail, validate, C.sendFactusInvoiceEmail);

router.get('/notificaciones', auth, [query('limit').optional().isInt({ min: 1, max: 100 }).toInt()], validate, C.listNotifications);
router.patch('/notificaciones/:id/leida', auth, V.idParam, validate, C.markNotificationRead);
router.patch('/notificaciones/leidas/todas', auth, C.markAllNotificationsRead);

router.get('/usuarios', auth, roles('administrador'), C.listUsuarios);
router.post('/usuarios', auth, roles('administrador'), V.userCreate, validate, C.createUsuario);
router.patch('/usuarios/:id/estado', auth, roles('administrador'), V.userState, validate, C.toggleUsuario);
router.post('/sistema/reiniciar-datos', auth, roles('administrador'), [body('confirmacion').equals('REINICIAR')], validate, C.resetOperationalData);

router.get('/reportes/ventas', auth, roles('administrador'), V.reportQuery, validate, C.reportSales);
router.get('/auditoria', auth, roles('administrador'), C.auditList);

module.exports = router;
