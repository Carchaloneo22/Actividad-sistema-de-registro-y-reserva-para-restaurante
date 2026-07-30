let user = null;
let socket = null;
let activeRoute = 'dashboard';
let activeOrdersTab = 'pedidos';
let orderHistoryDate = localDateValue();
let tableStatusFilter = 'all';
let tableSearch = '';
let waiterOrderView = 'attention';
let orderTableFilter = null;
let pendingQuickOrderTableId = null;
let orderPickerCategoryId = null;
let additionalPickerCategoryId = null;

const state = {
  dashboard: null,
  mesas: [],
  meseros: [],
  reservas: [],
  pedidos: [],
  historialPedidos: [],
  catalogo: { categorias: [], platos: [] },
  metodosPago: [],
  usuarios: [],
  report: null,
  notifications: [],
  unreadNotifications: 0,
  factus: { enabled: false, configured: false, mock_mode: false, environment: 'mock', missing: [] },
};

const routeMeta = {
  dashboard: { label: 'Panel', icon: '🏠' },
  mesas: { label: 'Mesas', icon: '🪑' },
  reservas: { label: 'Reservas', icon: '📅' },
  pedidos: { label: 'Pedidos / Platos', icon: '🧾' },
  despacho: { label: 'Despachos', icon: '🔔' },
  cocina: { label: 'Cocina', icon: '🍳' },
  usuarios: { label: 'Usuarios', icon: '👥' },
  reportes: { label: 'Reportes', icon: '📊' },
};

const roleRoutes = {
  administrador: ['dashboard', 'mesas', 'reservas', 'pedidos', 'despacho', 'cocina', 'usuarios', 'reportes'],
  mesero: ['dashboard', 'mesas', 'pedidos'],
  despacho: ['dashboard', 'reservas', 'despacho', 'pedidos'],
  cocina: ['cocina'],
};

const renderers = {
  dashboard: renderDashboard,
  mesas: renderMesas,
  reservas: renderReservas,
  pedidos: renderPedidos,
  despacho: renderDespacho,
  cocina: renderCocina,
  usuarios: renderUsuarios,
  reportes: renderReportes,
};

function enhanceResponsiveTables(root = document) {
  root.querySelectorAll('.data-table').forEach((table) => {
    const labels = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((row) => {
      Array.from(row.children).forEach((cell, index) => {
        if (cell.tagName === 'TD') cell.dataset.label = labels[index] || '';
      });
    });
  });
}

async function init() {
  try {
    user = await api('/auth/me');
    document.querySelector('#userName').textContent = user.nombre;
    document.querySelector('#userAccount').textContent = `@${user.usuario}`;
    document.querySelector('#roleLabel').textContent = roleName(user.rol);
    const view = document.querySelector('#view');
    new MutationObserver(() => enhanceResponsiveTables(view)).observe(view, { childList: true, subtree: true });
    buildMenu();
    setupRoleExperience();

    if (user.debe_cambiar_password) {
      showMandatoryPasswordChange();
      return;
    }
    await openInitialRoute();
  } catch (error) {
    location.href = '/login.html';
  }
}


async function openInitialRoute() {
  if (!socket) connectSocket();
  setupNotificationCenter();
  const requested = location.hash.slice(1);
  const available = roleRoutes[user.rol] || [];
  await navigate(available.includes(requested) ? requested : available[0]);
  if (user.rol === 'mesero') setTimeout(showWaiterGuideIfNeeded, 450);
}

function showMandatoryPasswordChange() {
  if (!document.querySelector('#mandatoryPasswordDialog')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="mandatoryPasswordDialog" class="security-dialog">
      <div class="dialog-header"><div><span class="eyebrow">SEGURIDAD DE LA CUENTA</span><h2>Cambia la contraseña temporal</h2><p>Antes de usar el sistema debes crear una contraseña personal.</p></div></div>
      <form class="dialog-body" onsubmit="saveMandatoryPassword(event)">
        <div class="field"><label>Contraseña temporal</label><input name="actual" type="password" minlength="8" maxlength="72" autocomplete="current-password" required></div>
        <div class="field"><label>Nueva contraseña</label><input name="nueva" type="password" minlength="10" maxlength="72" autocomplete="new-password" required><small class="field-help">Mínimo 10 caracteres, con mayúscula, minúscula, número y símbolo.</small></div>
        <div class="field"><label>Repite la nueva contraseña</label><input name="confirmacion" type="password" minlength="10" maxlength="72" autocomplete="new-password" required></div>
        <p class="form-alert" data-password-error role="alert"></p>
        <div class="form-actions"><button class="btn btn-primary btn-block">Guardar y continuar</button></div>
      </form>
    </dialog>`);
  }
  const dialog = document.querySelector('#mandatoryPasswordDialog');
  if (!dialog.open) dialog.showModal();
}

async function saveMandatoryPassword(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = form.querySelector('[data-password-error]');
  error.textContent = '';
  if (form.nueva.value !== form.confirmacion.value) {
    error.textContent = 'Las contraseñas nuevas no coinciden.';
    return;
  }
  const button = event.submitter;
  button.disabled = true;
  try {
    await api('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ actual: form.actual.value, nueva: form.nueva.value }),
    });
    user.debe_cambiar_password = false;
    document.querySelector('#mandatoryPasswordDialog').close();
    toast('Contraseña personal guardada correctamente.');
    await openInitialRoute();
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    button.disabled = false;
  }
}

function connectSocket() {
  if (typeof io !== 'function') return;
  socket = io(location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'http://localhost:3000' : location.origin, {
    withCredentials: true,
  });
  socket.on('pedido:actualizado', () => {
    if (['dashboard', 'pedidos', 'despacho', 'cocina', 'mesas'].includes(activeRoute)) refreshCurrent(false);
  });
  socket.on('notificacion:nueva', (notification) => {
    state.notifications.unshift(notification);
    state.unreadNotifications += 1;
    updateNotificationBadge();
    playNotificationTone();
    toast(`${notification.titulo}: ${notification.mensaje}`, 'success');
    if (user.rol === 'mesero' && ['dashboard', 'pedidos'].includes(activeRoute)) refreshCurrent(false);
  });
}

function menuLabel(route) {
  if (user?.rol === 'mesero') return ({ dashboard: 'Inicio', mesas: 'Mesas', pedidos: 'Mis pedidos' })[route] || routeMeta[route]?.label || route;
  if (user?.rol === 'despacho') return ({ dashboard: 'Inicio de caja', reservas: 'Reservas', despacho: 'Despacho', pedidos: 'Caja / Pedidos' })[route] || routeMeta[route]?.label || route;
  return routeMeta[route]?.label || route;
}

function buildMenu() {
  const routes = roleRoutes[user.rol] || [];
  document.querySelector('#nav').innerHTML = routes.map((route) => {
    const meta = routeMeta[route];
    return `<a href="#${route}" data-route="${route}"><span class="nav-icon" aria-hidden="true">${meta.icon}</span><span>${menuLabel(route)}</span></a>`;
  }).join('');
}

function setupNotificationCenter() {
  if (user.rol !== 'mesero') return;
  const logout = document.querySelector('#logout');
  if (!document.querySelector('#notificationButton')) {
    const button = document.createElement('button');
    button.id = 'notificationButton';
    button.className = 'notification-button';
    button.type = 'button';
    button.setAttribute('aria-label', 'Abrir notificaciones');
    button.innerHTML = '<span aria-hidden="true">🔔</span><b id="notificationCount" hidden>0</b>';
    button.onclick = openNotificationCenter;
    logout.parentElement.insertBefore(button, logout);
  }
  if (!document.querySelector('#notificationDialog')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="notificationDialog" class="notification-dialog">
      <div class="dialog-header"><div><span class="eyebrow">AVISOS DEL TURNO</span><h2>Notificaciones</h2><p>Despacho te avisará cuando un pedido esté revisado y listo para recoger.</p></div><button class="dialog-close" onclick="closeDialog('notificationDialog')" aria-label="Cerrar">×</button></div>
      <div class="dialog-body"><div class="notification-toolbar"><strong id="notificationSummary">Sin avisos nuevos</strong><button class="btn btn-secondary btn-sm" type="button" onclick="markAllNotificationsRead()">Marcar todas como leídas</button></div><div id="notificationList" class="notification-list"></div></div>
    </dialog>`);
  }
  loadNotifications(false);
}

async function loadNotifications(render = true) {
  if (user?.rol !== 'mesero') return;
  try {
    const result = await api('/notificaciones?limit=40');
    state.notifications = result.notificaciones || [];
    state.unreadNotifications = Number(result.no_leidas || 0);
    updateNotificationBadge();
    if (render) renderNotificationList();
  } catch (_) {
    // Las notificaciones no deben impedir que el resto del sistema cargue.
  }
}

function updateNotificationBadge() {
  const count = document.querySelector('#notificationCount');
  if (!count) return;
  count.textContent = state.unreadNotifications > 99 ? '99+' : String(state.unreadNotifications);
  count.hidden = state.unreadNotifications <= 0;
}

async function openNotificationCenter() {
  await loadNotifications(false);
  renderNotificationList();
  openDialog('notificationDialog');
}

function renderNotificationList() {
  const summary = document.querySelector('#notificationSummary');
  const list = document.querySelector('#notificationList');
  if (!list) return;
  if (summary) summary.textContent = state.unreadNotifications ? `${state.unreadNotifications} aviso(s) sin leer` : 'No tienes avisos nuevos';
  list.innerHTML = state.notifications.length
    ? state.notifications.map((item) => `<button type="button" class="notification-item ${item.leida ? '' : 'unread'}" onclick="readNotification(${item.id})"><span class="notification-item-icon">${item.tipo === 'pedido_listo' ? '🍽' : '🔔'}</span><span><strong>${escapeHtml(item.titulo || 'Aviso')}</strong><small>${escapeHtml(item.mensaje || '')}</small><time>${formatDateTime(item.createdAt || item.created_at)}</time></span></button>`).join('')
    : '<div class="waiter-all-clear"><span>✓</span><div><strong>No hay notificaciones</strong><p>Cuando despacho revise un pedido listo, el aviso aparecerá aquí.</p></div></div>';
}

async function readNotification(id) {
  const item = state.notifications.find((notification) => Number(notification.id) === Number(id));
  if (item && !item.leida) {
    try {
      await api(`/notificaciones/${id}/leida`, { method: 'PATCH' });
      item.leida = true;
      state.unreadNotifications = Math.max(0, state.unreadNotifications - 1);
      updateNotificationBadge();
      renderNotificationList();
    } catch (error) {
      toast(error.message, 'error');
    }
  }
  if (item?.tipo === 'pedido_listo') {
    closeDialog('notificationDialog');
    navigate('pedidos');
  }
}

async function markAllNotificationsRead() {
  try {
    await api('/notificaciones/leidas/todas', { method: 'PATCH' });
    state.notifications.forEach((item) => { item.leida = true; });
    state.unreadNotifications = 0;
    updateNotificationBadge();
    renderNotificationList();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function playNotificationTone() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(880, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  } catch (_) {
    // Algunos navegadores bloquean audio automático; el aviso visual permanece.
  }
}

function setupRoleExperience() {
  if (user.rol !== 'mesero') return;
  document.body.classList.add('waiter-mode');

  const logout = document.querySelector('#logout');
  if (!document.querySelector('#waiterHelpButton')) {
    const help = document.createElement('button');
    help.id = 'waiterHelpButton';
    help.className = 'text-button waiter-help-button';
    help.type = 'button';
    help.textContent = 'Ayuda';
    help.onclick = showWaiterGuide;
    logout.parentElement.insertBefore(help, logout);
  }

  if (!document.querySelector('#waiterBottomNav')) {
    document.body.insertAdjacentHTML('beforeend', `<nav id="waiterBottomNav" class="waiter-bottom-nav" aria-label="Accesos rápidos">
      <button type="button" data-bottom-route="dashboard" onclick="navigate('dashboard')"><span>🏠</span><small>Inicio</small></button>
      <button type="button" data-bottom-route="mesas" onclick="navigate('mesas')"><span>🪑</span><small>Mesas</small></button>
      <button type="button" data-bottom-route="pedidos" onclick="navigate('pedidos')"><span>🧾</span><small>Pedidos</small></button>
      <button type="button" onclick="openNotificationCenter()"><span>🔔</span><small>Avisos</small></button>
    </nav>`);
  }

  if (!document.querySelector('#waiterGuideDialog')) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="waiterGuideDialog" class="waiter-guide-dialog">
      <div class="dialog-header"><div><span class="eyebrow">GUÍA RÁPIDA</span><h2>Cómo atender una mesa</h2><p>El sistema te acompaña paso a paso. No necesitas memorizar menús.</p></div><button class="dialog-close" onclick="closeWaiterGuide()" aria-label="Cerrar">×</button></div>
      <div class="dialog-body">
        <div class="waiter-guide-steps">
          <article><span>1</span><div><strong>Busca la mesa</strong><p>Entra a Mesas y pulsa “Ocupar mesa” cuando lleguen los clientes.</p></div></article>
          <article><span>2</span><div><strong>Toma el pedido</strong><p>Pulsa “Tomar pedido”, elige categoría, plato y cantidad.</p></div></article>
          <article><span>3</span><div><strong>Espera el aviso</strong><p>Cocina prepara el pedido y despacho lo revisa. Recibirás una notificación cuando esté listo para recoger.</p></div></article>
          <article><span>4</span><div><strong>Recoge y entrega</strong><p>Ve a despacho, recoge el pedido y confirma cuando lo hayas entregado al cliente. Caja registra el pago.</p></div></article>
        </div>
        <label class="guide-preference"><input id="hideWaiterGuide" type="checkbox"> No mostrar automáticamente en este equipo</label>
        <div class="form-actions"><button class="btn btn-primary btn-block" type="button" onclick="closeWaiterGuide()">Entendido, comenzar</button></div>
      </div>
    </dialog>`);
  }
}

function showWaiterGuideIfNeeded() {
  if (localStorage.getItem(`reservarest-waiter-guide-${user.usuario}`) !== 'hidden') showWaiterGuide();
}

function showWaiterGuide() {
  openDialog('waiterGuideDialog');
}

function closeWaiterGuide() {
  const checkbox = document.querySelector('#hideWaiterGuide');
  if (checkbox?.checked) localStorage.setItem(`reservarest-waiter-guide-${user.usuario}`, 'hidden');
  closeDialog('waiterGuideDialog');
}

async function navigate(route, updateHash = true) {
  const allowed = roleRoutes[user.rol] || [];
  if (!allowed.includes(route)) route = allowed[0];
  activeRoute = route;
  if (updateHash && location.hash !== `#${route}`) history.replaceState(null, '', `#${route}`);

  document.querySelectorAll('[data-route]').forEach((link) => link.classList.toggle('active', link.dataset.route === route));
  document.querySelectorAll('[data-bottom-route]').forEach((link) => link.classList.toggle('active', link.dataset.bottomRoute === route));
  document.querySelector('#pageTitle').textContent = menuLabel(route);
  closeSidebar();
  setLoading();

  try {
    await renderers[route]();
  } catch (error) {
    renderError(error);
  }
}

async function refreshCurrent(showLoading = true) {
  if (showLoading) setLoading();
  try {
    await renderers[activeRoute]();
  } catch (error) {
    renderError(error);
  }
}

window.addEventListener('hashchange', () => navigate(location.hash.slice(1), false));

document.querySelector('#logout').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* close locally */ }
  sessionStorage.removeItem('user');
  location.href = '/login.html';
});

document.querySelector('#menuBtn').addEventListener('click', () => {
  document.querySelector('#sidebar').classList.add('open');
  document.querySelector('#sidebarBackdrop').classList.add('visible');
});
document.querySelector('#sidebarBackdrop').addEventListener('click', closeSidebar);

function closeSidebar() {
  document.querySelector('#sidebar').classList.remove('open');
  document.querySelector('#sidebarBackdrop').classList.remove('visible');
}

function main() { return document.querySelector('#view'); }
function setLoading() { main().innerHTML = '<div class="panel loading-card"><span class="spinner"></span> Cargando información...</div>'; }
function renderError(error) {
  main().innerHTML = `<div class="panel empty-state"><span class="empty-icon">⚠</span><h3>No fue posible cargar este módulo</h3><p>${escapeHtml(error.message)}</p><button class="btn btn-primary" onclick="refreshCurrent()">Intentar otra vez</button></div>`;
  toast(error.message, 'error');
}

function pageHeading(title, description, actions = '') {
  return `<header class="page-heading"><div><span class="eyebrow">RESERVAREST</span><h1>${title}</h1><p>${description}</p></div><div class="heading-actions no-print">${actions}</div></header>`;
}

function emptyState(icon, title, description, action = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon}</span><h3>${title}</h3><p>${description}</p>${action}</div>`;
}

function money(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return '-';
  const date = String(value).includes('T') ? new Date(value) : new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(value));
}

function recordTimestamp(record) {
  return record?.createdAt || record?.created_at || record?.fecha_pago || record?.fecha || null;
}

function paymentDateMarkup(payment) {
  const timestamp = recordTimestamp(payment);
  if (!timestamp) return '<span class="payment-date payment-date-missing">Sin fecha</span>';
  return `<span class="payment-date"><strong>${formatDate(timestamp)}</strong><small>${formatTime(timestamp)}</small></span>`;
}

function paymentReference(payment) {
  const reference = String(payment?.referencia || payment?.referencia_pago || '').trim();
  if (reference) return { text: reference, type: 'registered' };
  const method = String(payment?.MetodoPago?.nombre || '').toLowerCase();
  if (method.includes('efectivo')) return { text: 'No aplica', type: 'na' };
  return { text: 'Sin referencia', type: 'missing' };
}

function paymentReferenceMarkup(payment) {
  const reference = paymentReference(payment);
  return `<span class="payment-reference payment-reference-${reference.type}">${escapeHtml(reference.text)}</span>`;
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function elapsed(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function roleName(role) {
  return ({ administrador: 'Administrador', mesero: 'Mesero', despacho: 'Despacho / Caja', cocina: 'Cocina' })[role] || role;
}

function statusLabel(status) {
  const labels = {
    disponible: 'Disponible', reservada: 'Reservada', ocupada: 'Ocupada', limpieza: 'En limpieza', fuera_servicio: 'Fuera de servicio',
    pendiente: 'Pendiente', confirmada: 'Confirmada', cliente_presente: 'Cliente en mesa', completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió',
    borrador: 'Borrador', enviado_despacho: 'Esperando despacho', confirmado_despacho: 'Despacho confirmó', enviado_cocina: 'Enviado a cocina', en_preparacion: 'En preparación', listo: 'Listo · pendiente de revisión', en_entrega: 'Mesero avisado · listo para recoger', entregado: 'Entregado · pendiente de pago', pagado: 'Pagado', rechazado: 'Rechazado',
    preparado: 'Preparado', preparando: 'Preparando', no_disponible: 'No disponible', activo: 'Activo', inactivo: 'Inactivo', no_pagado: 'Pendiente de pago', parcial: 'Pago parcial',
  };
  return labels[status] || String(status || '').replaceAll('_', ' ');
}

function badge(status) {
  const classes = {
    disponible: 'success', reservada: 'warning', ocupada: 'danger', limpieza: 'info', fuera_servicio: 'purple',
    pendiente: 'warning', confirmada: 'info', cliente_presente: 'success', completada: 'success', cancelada: 'danger', no_asistio: 'purple',
    enviado_despacho: 'warning', confirmado_despacho: 'info', enviado_cocina: 'purple', en_preparacion: 'warning', listo: 'success', en_entrega: 'info', entregado: 'success', pagado: 'success', rechazado: 'danger',
    preparado: 'success', preparando: 'warning', no_disponible: 'danger', activo: 'success', inactivo: 'danger',
  };
  return `<span class="badge badge-${classes[status] || 'wine'}">${escapeHtml(statusLabel(status))}</span>`;
}

function openDialog(id) {
  const dialog = document.querySelector(`#${id}`);
  if (dialog && !dialog.open) dialog.showModal();
}
function closeDialog(id) {
  const dialog = document.querySelector(`#${id}`);
  if (dialog?.open) dialog.close();
}

/* Dashboard */
async function renderDashboard() {
  if (user.rol === 'mesero') return renderWaiterDashboard();
  if (user.rol === 'despacho') return renderDispatchDashboard();

  state.dashboard = await api('/dashboard');
  const d = state.dashboard;
  const cards = [
    ['📅', d.reservas_hoy, 'Reservas de hoy'],
    ['🍽', d.pedidos.cocina, 'Platos pendientes'],
    ['🔔', d.pedidos.despachos_activos, 'Despachos activos'],
    ['🪑', d.mesas.ocupadas, 'Mesas ocupadas'],
    ['▦', d.mesas.reservadas, 'Mesas reservadas'],
    ['◉', d.platos.activos, 'Platos activos'],
  ];

  main().innerHTML = `
    ${pageHeading('Panel principal', `Resumen del día · ${formatDate(new Date().toISOString().slice(0, 10))}`)}
    <section class="stats-grid">
      ${cards.map(([icon, value, label]) => `<article class="stat-card"><span class="stat-icon">${icon}</span><div><strong>${value}</strong><small>${label}</small></div></article>`).join('')}
    </section>
    <section class="panel">
      <div class="panel-header"><h2>Reservas de hoy</h2><button class="btn btn-secondary btn-sm no-print" onclick="navigate('reservas')">Ver todas</button></div>
      ${d.reservas.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Hora</th><th>Cliente</th><th>Mesa</th><th>Personas</th><th>Estado</th></tr></thead><tbody>${d.reservas.map((r) => `<tr><td><strong>${String(r.hora).slice(0, 5)}</strong></td><td>${escapeHtml(r.Cliente?.nombre || '-')}</td><td>Mesa ${r.Mesa?.numero || '-'}</td><td>${r.personas}</td><td>${badge(r.estado)}</td></tr>`).join('')}</tbody></table></div>` : emptyState('📅', 'No hay reservas registradas', 'Las reservas creadas para hoy aparecerán en esta sección.', '<button class="btn btn-primary" onclick="navigate(\'reservas\')">Crear reserva</button>')}
    </section>
  `;
}

async function renderWaiterDashboard() {
  [state.dashboard, state.mesas, state.pedidos] = await Promise.all([
    api('/dashboard'), api('/mesas'), api('/pedidos'),
  ]);
  await loadNotifications(false);

  const firstName = String(user.nombre || 'Mesero').split(' ')[0];
  const readyOrders = state.pedidos.filter((p) => p.estado === 'en_entrega');
  const preparingOrders = state.pedidos.filter((p) => ['enviado_cocina', 'en_preparacion', 'listo'].includes(p.estado));
  const deliveredOrders = state.pedidos.filter((p) => p.estado === 'entregado' && p.estado_pago !== 'pagado');
  const availableTables = state.mesas.filter((m) => m.estado === 'disponible').length;
  const occupiedTables = state.mesas.filter((m) => m.estado === 'ocupada').length;
  const attentionCount = readyOrders.length;

  const attentionItems = readyOrders.map((p) => `<article class="attention-item attention-ready"><span class="attention-icon">🔔</span><div><strong>Mesa ${p.Mesa?.numero || '-'}: pedido verificado</strong><small>${escapeHtml(p.numero)} · Ve a despacho para recogerlo</small></div><button class="btn btn-success btn-sm" onclick="openOrderForTable(${p.MesaId})">Recoger y entregar</button></article>`);

  main().innerHTML = `
    ${pageHeading(`Hola, ${escapeHtml(firstName)}`, 'Toma pedidos y espera el aviso de despacho antes de recogerlos.', '<button class="btn btn-secondary" onclick="openNotificationCenter()">🔔 Ver avisos</button><button class="btn btn-secondary" onclick="showWaiterGuide()">? Guía rápida</button>')}
    <section class="waiter-quick-grid waiter-quick-grid-three">
      <button class="quick-action-card" onclick="navigate('mesas')"><span>🪑</span><strong>Atender una mesa</strong><small>${availableTables} disponibles · ${occupiedTables} ocupadas</small></button>
      <button class="quick-action-card quick-primary" onclick="startQuickOrder()"><span>🧾</span><strong>Tomar pedido</strong><small>Seleccionar mesa, categoría y platos</small></button>
      <button class="quick-action-card" onclick="navigate('pedidos')"><span>🔎</span><strong>Mis pedidos</strong><small>${readyOrders.length} para recoger · ${preparingOrders.length} en proceso</small></button>
    </section>

    <section class="panel waiter-attention-panel">
      <div class="panel-header"><div><h2>Listos para recoger</h2><small>${attentionCount ? `${attentionCount} pedidos requieren tu atención` : 'Despacho te avisará aquí'}</small></div></div>
      <div class="attention-list">${attentionItems.length ? attentionItems.join('') : `<div class="waiter-all-clear"><span>✓</span><div><strong>No tienes pedidos listos para recoger</strong><p>Puedes atender mesas o revisar los pedidos que están en cocina.</p></div></div>`}</div>
    </section>

    <section class="panel waiter-flow-panel">
      <div class="panel-header"><h2>Flujo de atención</h2><button class="btn btn-secondary btn-sm" onclick="showWaiterGuide()">Ver explicación</button></div>
      <div class="waiter-flow">
        <article><span>1</span><strong>Ocupar mesa</strong><small>Cuando llegan los clientes</small></article>
        <i>→</i><article><span>2</span><strong>Tomar pedido</strong><small>Platos, cantidades y notas</small></article>
        <i>→</i><article><span>3</span><strong>Esperar aviso</strong><small>Despacho verifica lo preparado</small></article>
        <i>→</i><article><span>4</span><strong>Recoger y entregar</strong><small>Caja se encarga del pago</small></article>
      </div>
    </section>
    ${deliveredOrders.length ? `<div class="inline-tip"><span>💳</span><div><strong>${deliveredOrders.length} cuenta(s) pendientes en caja</strong><p>El pedido ya fue entregado. Informa al cliente que el pago se registra en despacho/caja.</p></div></div>` : ''}
  `;
}

async function renderDispatchDashboard() {
  [state.dashboard, state.pedidos, state.reservas] = await Promise.all([
    api('/dashboard'), api('/pedidos'), api('/reservas'),
  ]);
  const today = localDateValue();
  const todayReservations = state.reservas.filter((r) => r.fecha === today && ['pendiente', 'confirmada', 'cliente_presente'].includes(r.estado));
  const reviewOrders = state.pedidos.filter((p) => p.estado === 'listo');
  const payments = state.pedidos.filter((p) => p.estado === 'entregado' && p.estado_pago !== 'pagado');
  const incoming = state.pedidos.filter((p) => ['enviado_despacho', 'confirmado_despacho'].includes(p.estado));

  main().innerHTML = `
    ${pageHeading('Despacho y caja', 'Gestiona reservas, verifica pedidos listos y registra pagos.', '<button class="btn btn-primary" onclick="prepareQuickReservation()">+ Nueva reserva</button>')}
    <section class="waiter-quick-grid">
      <button class="quick-action-card" onclick="navigate('reservas')"><span>📅</span><strong>Reservas de hoy</strong><small>${todayReservations.length} activas</small></button>
      <button class="quick-action-card" onclick="navigate('despacho')"><span>📥</span><strong>Pedidos recibidos</strong><small>${incoming.length} por gestionar</small></button>
      <button class="quick-action-card quick-primary" onclick="navigate('despacho')"><span>✓</span><strong>Verificar y avisar</strong><small>${reviewOrders.length} listos desde cocina</small></button>
      <button class="quick-action-card" onclick="navigate('despacho')"><span>💳</span><strong>Cobros pendientes</strong><small>${payments.length} cuentas por registrar</small></button>
    </section>
    <section class="panel"><div class="panel-header"><h2>Prioridades del turno</h2></div><div class="attention-list">
      ${reviewOrders.map((p) => `<article class="attention-item attention-ready"><span class="attention-icon">✓</span><div><strong>Mesa ${p.Mesa?.numero || '-'}: revisar pedido</strong><small>${escapeHtml(p.numero)} · Confirma que esté completo antes de avisar al mesero</small></div><button class="btn btn-primary btn-sm" onclick="navigate('despacho')">Revisar</button></article>`).join('')}
      ${payments.map((p) => `<article class="attention-item attention-payment"><span class="attention-icon">💳</span><div><strong>Mesa ${p.Mesa?.numero || '-'}: cobrar ${money(p.total)}</strong><small>${escapeHtml(p.numero)}</small></div><button class="btn btn-primary btn-sm" onclick="navigate('despacho')">Ir a caja</button></article>`).join('')}
      ${!reviewOrders.length && !payments.length ? `<div class="waiter-all-clear"><span>✓</span><div><strong>No hay revisiones ni cobros pendientes</strong><p>Revisa las reservas o los pedidos nuevos.</p></div></div>` : ''}
    </div></section>`;
}

async function prepareQuickReservation() {
  await navigate('reservas');
  prepareReservationForm();
}

async function startQuickOrder(mesaId = null) {
  pendingQuickOrderTableId = mesaId;
  activeOrdersTab = 'pedidos';
  await navigate('pedidos');
  prepareOrderForm(pendingQuickOrderTableId);
  pendingQuickOrderTableId = null;
}

async function openOrderForTable(mesaId) {
  orderTableFilter = Number(mesaId);
  activeOrdersTab = 'pedidos';
  await navigate('pedidos');
}

/* Mesas */
async function renderMesas() {
  const extraRequests = user.rol === 'mesero'
    ? [api('/pedidos'), api('/reservas')]
    : [Promise.resolve([]), Promise.resolve([])];

  [state.mesas, state.meseros, state.pedidos, state.reservas] = await Promise.all([
    api(`/mesas${user.rol === 'administrador' ? '?todas=1' : ''}`),
    api('/meseros').catch(() => []),
    ...extraRequests,
  ]);

  const actions = user.rol === 'administrador'
    ? '<button class="btn btn-primary" onclick="prepareMesaForm()">+ Nueva mesa</button>'
    : '<button class="btn btn-primary" onclick="startQuickOrder()">+ Tomar pedido</button>';

  main().innerHTML = `
    ${pageHeading(user.rol === 'mesero' ? 'Mesas del restaurante' : 'Estado actual de las mesas', user.rol === 'mesero' ? 'Busca una mesa y el sistema te mostrará la siguiente acción.' : 'Consulta disponibilidad, capacidad y estado en tiempo real.', actions)}
    ${user.rol === 'mesero' ? `<section class="panel waiter-table-tools"><div class="waiter-table-search"><label for="tableSearch">Buscar mesa</label><input id="tableSearch" class="search-input" type="search" value="${escapeHtml(tableSearch)}" placeholder="Escribe el número o la zona" oninput="setTableSearch(this.value)"></div><div class="status-filter-chips" role="group" aria-label="Filtrar mesas"><button class="filter-chip ${tableStatusFilter === 'all' ? 'active' : ''}" onclick="setTableStatusFilter('all')">Todas</button><button class="filter-chip ${tableStatusFilter === 'disponible' ? 'active' : ''}" onclick="setTableStatusFilter('disponible')">Disponibles</button><button class="filter-chip ${tableStatusFilter === 'reservada' ? 'active' : ''}" onclick="setTableStatusFilter('reservada')">Reservadas</button><button class="filter-chip ${tableStatusFilter === 'ocupada' ? 'active' : ''}" onclick="setTableStatusFilter('ocupada')">Ocupadas</button><button class="filter-chip ${tableStatusFilter === 'limpieza' ? 'active' : ''}" onclick="setTableStatusFilter('limpieza')">En limpieza</button></div></section>` : ''}
    <section id="tableGrid" class="table-grid waiter-table-grid">${renderFilteredTables()}</section>
    ${user.rol === 'administrador' ? renderTableManagement() : ''}
    ${renderMesaDialog()}
  `;
}

function renderFilteredTables() {
  const term = tableSearch.trim().toLowerCase();
  const tables = state.mesas.filter((m) => m.activo)
    .filter((m) => tableStatusFilter === 'all' || m.estado === tableStatusFilter)
    .filter((m) => !term || String(m.numero).includes(term) || String(m.zona || '').toLowerCase().includes(term));
  return tables.length ? tables.map(renderTableCard).join('') : emptyState('🪑', 'No encontramos mesas', 'Prueba con otro número o cambia el filtro.');
}

function setTableSearch(value) {
  tableSearch = value;
  const grid = document.querySelector('#tableGrid');
  if (grid) grid.innerHTML = renderFilteredTables();
}

function setTableStatusFilter(status) {
  tableStatusFilter = status;
  document.querySelectorAll('.filter-chip').forEach((button) => button.classList.toggle('active', button.textContent.toLowerCase().includes(status === 'all' ? 'todas' : status.replace('_', ' '))));
  const grid = document.querySelector('#tableGrid');
  if (grid) grid.innerHTML = renderFilteredTables();
}

function renderTableCard(mesa) {
  const activeOrder = state.pedidos.find((p) => Number(p.MesaId) === Number(mesa.id) && p.estado_pago !== 'pagado' && !['cancelado', 'rechazado'].includes(p.estado));
  const activeReservation = state.reservas.find((r) => Number(r.MesaId) === Number(mesa.id) && ['pendiente', 'confirmada', 'cliente_presente'].includes(r.estado));
  let action = '';
  let helper = '';

  if (mesa.estado === 'disponible' && ['administrador', 'mesero'].includes(user.rol)) {
    helper = 'Lista para recibir clientes';
    action = `<button class="btn btn-primary btn-block" onclick="occupyTable(${mesa.id})">Ocupar mesa</button>`;
  } else if (mesa.estado === 'reservada' && ['administrador', 'mesero'].includes(user.rol)) {
    helper = activeReservation ? `Reserva: ${escapeHtml(activeReservation.Cliente?.nombre || 'Cliente')} · ${String(activeReservation.hora || '').slice(0, 5)}` : 'Tiene una reserva activa';
    action = user.rol === 'mesero' ? '<div class="table-action-note">La llegada la confirma despacho/caja</div>' : `<button class="btn btn-primary btn-block" onclick="navigate('reservas')">Confirmar llegada</button>`;
  } else if (mesa.estado === 'ocupada' && ['administrador', 'mesero'].includes(user.rol)) {
    helper = activeOrder ? `${statusLabel(activeOrder.estado)} · ${money(activeOrder.total)}` : 'Clientes sentados · pedido pendiente';
    action = activeOrder
      ? `<button class="btn btn-soft btn-block" onclick="openOrderForTable(${mesa.id})">Ver pedido</button>`
      : `<button class="btn btn-primary btn-block" onclick="startQuickOrder(${mesa.id})">Tomar pedido</button>`;
  } else if (mesa.estado === 'limpieza' && ['administrador', 'mesero'].includes(user.rol)) {
    helper = 'Confirma cuando esté limpia';
    action = `<button class="btn btn-success btn-block" onclick="releaseTable(${mesa.id})">Ya está limpia</button>`;
  } else {
    helper = 'Sin acciones disponibles';
  }

  return `<article class="table-card ${mesa.estado}"><div class="table-card-top"><div><span class="table-number-label">MESA</span><h3>${mesa.numero}</h3></div>${badge(mesa.estado)}</div><p>${escapeHtml(mesa.zona || 'Salón')} · Capacidad: ${mesa.capacidad}</p><p class="table-helper">${helper}</p><div class="card-actions">${action}</div></article>`;
}

function renderTableManagement() {
  return `<section class="panel"><div class="panel-header"><h2>Gestión de mesas</h2><small>${state.mesas.length} registros</small></div><div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Capacidad</th><th>Zona</th><th>Estado</th><th>Mesero</th><th>Acciones</th></tr></thead><tbody>${state.mesas.map((m) => `<tr><td><strong>${m.numero}</strong></td><td>${m.capacidad}</td><td>${escapeHtml(m.zona || '-')}</td><td>${badge(m.activo ? m.estado : 'inactivo')}</td><td>${escapeHtml(m.Mesero?.codigo || 'Sin asignar')}</td><td><div class="table-actions"><button class="btn btn-secondary btn-sm" onclick="prepareMesaForm(${m.id})">Editar</button>${m.activo ? `<button class="btn btn-danger btn-sm" onclick="deactivateTable(${m.id})">Eliminar</button>` : ''}</div></td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderMesaDialog() {
  return `<dialog id="mesaDialog"><div class="dialog-header"><div><h2 id="mesaDialogTitle">Nueva mesa</h2><p>Define la capacidad, zona y estado de la mesa.</p></div><button class="dialog-close" onclick="closeDialog('mesaDialog')" aria-label="Cerrar">×</button></div><form id="mesaForm" class="dialog-body" onsubmit="saveMesa(event)"><input type="hidden" name="id"><div class="form-grid"><div class="field"><label>Número de mesa</label><input name="numero" type="number" min="1" required></div><div class="field"><label>Capacidad</label><input name="capacidad" type="number" min="1" required></div><div class="field"><label>Zona</label><input name="zona" placeholder="Ej. Terraza"></div><div class="field"><label>Estado</label><select name="estado"><option value="disponible">Disponible</option><option value="reservada">Reservada</option><option value="ocupada">Ocupada</option><option value="limpieza">En limpieza</option><option value="fuera_servicio">Fuera de servicio</option></select></div><div class="field span-2"><label>Mesero asignado</label><select name="MeseroId"><option value="">Sin asignar</option>${state.meseros.map((m) => `<option value="${m.id}">${escapeHtml(m.Usuario?.nombre || m.codigo)} · ${m.codigo}</option>`).join('')}</select></div></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeDialog('mesaDialog')">Cancelar</button><button class="btn btn-primary">Guardar mesa</button></div></form></dialog>`;
}

function prepareMesaForm(id = null) {
  const form = document.querySelector('#mesaForm');
  form.reset();
  form.id.value = '';
  document.querySelector('#mesaDialogTitle').textContent = id ? 'Editar mesa' : 'Nueva mesa';
  if (id) {
    const mesa = state.mesas.find((item) => item.id === id);
    form.id.value = mesa.id;
    form.numero.value = mesa.numero;
    form.capacidad.value = mesa.capacidad;
    form.zona.value = mesa.zona || '';
    form.estado.value = mesa.estado;
    form.MeseroId.value = mesa.MeseroId || '';
  }
  openDialog('mesaDialog');
}

async function saveMesa(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const id = values.id;
  const body = { ...values, numero: Number(values.numero), capacidad: Number(values.capacidad), MeseroId: values.MeseroId ? Number(values.MeseroId) : null };
  delete body.id;
  try {
    await api(id ? `/mesas/${id}` : '/mesas', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    closeDialog('mesaDialog');
    toast(id ? 'Mesa actualizada correctamente.' : 'Mesa creada correctamente.');
    await renderMesas();
  } catch (error) { toast(error.message, 'error'); }
}

async function occupyTable(id) {
  if (!confirm('¿Confirmas que la mesa será ocupada?')) return;
  try { await api(`/mesas/${id}/ocupar`, { method: 'POST' }); toast('Mesa ocupada. Ya puedes registrar el pedido.'); await renderMesas(); } catch (error) { toast(error.message, 'error'); }
}
async function releaseTable(id) {
  try { await api(`/mesas/${id}/liberar`, { method: 'POST' }); toast('Mesa disponible nuevamente.'); await renderMesas(); } catch (error) { toast(error.message, 'error'); }
}
async function deactivateTable(id) {
  if (!confirm('La mesa quedará fuera de servicio. ¿Deseas continuar?')) return;
  try { await api(`/mesas/${id}`, { method: 'DELETE' }); toast('Mesa desactivada.'); await renderMesas(); } catch (error) { toast(error.message, 'error'); }
}

/* Reservas */
async function renderReservas() {
  [state.reservas, state.mesas, state.meseros] = await Promise.all([
    api('/reservas'),
    api('/mesas'),
    api('/meseros'),
  ]);
  const actions = '<button class="btn btn-primary" onclick="prepareReservationForm()">+ Nueva reserva</button>';
  const sorted = [...state.reservas].sort((a, b) => {
    const activeA = ['pendiente', 'confirmada', 'cliente_presente'].includes(a.estado) ? 0 : 1;
    const activeB = ['pendiente', 'confirmada', 'cliente_presente'].includes(b.estado) ? 0 : 1;
    return activeA - activeB || new Date(`${a.fecha}T${a.hora}`) - new Date(`${b.fecha}T${b.hora}`);
  });
  main().innerHTML = `
    ${pageHeading('Reservas', 'Despacho/caja registra las reservas, confirma la llegada y asigna el mesero responsable.', actions)}
    <section class="panel">
      <div class="panel-header"><h2>Todas las reservas</h2><span>${state.reservas.length} registros</span></div>
      ${sorted.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Código</th><th>Cliente</th><th>Contacto</th><th>Mesa</th><th>Fecha y hora</th><th>Personas</th><th>Estado</th><th>Siguiente acción</th></tr></thead><tbody>${sorted.map(renderReservationRow).join('')}</tbody></table></div>` : emptyState('📅', 'No hay reservas registradas', 'Crea una reserva asignando cliente, mesa, fecha y hora.', '<button class="btn btn-primary" onclick="prepareReservationForm()">Nueva reserva</button>')}
    </section>
    ${renderReservationDialog()}
  `;
}

function renderReservationRow(r) {
  let actions = '';

  if (['pendiente', 'confirmada'].includes(r.estado)) {
    actions = `<button class="btn btn-success btn-sm" onclick="confirmArrival(${r.id})">Cliente llegó · ocupar mesa</button><button class="btn btn-danger btn-sm" onclick="cancelReservation(${r.id})">Cancelar</button>`;
  }

  if (r.estado === 'cliente_presente') {
    actions = `${user.rol === 'administrador' ? `<button class="btn btn-primary btn-sm" onclick="startQuickOrder(${r.MesaId})">Tomar pedido</button>` : '<span class="muted">Mesero avisado para atender</span>'}<button class="btn btn-secondary btn-sm" onclick="completeReservation(${r.id})">Finalizar atención</button>`;
  }

  return `<tr><td><strong>${escapeHtml(r.codigo)}</strong></td><td>${escapeHtml(r.Cliente?.nombre || '-')}</td><td>${escapeHtml(r.Cliente?.telefono || '-')}</td><td>Mesa ${r.Mesa?.numero || '-'}</td><td>${formatDate(r.fecha)} · ${String(r.hora).slice(0, 5)}</td><td>${r.personas}</td><td>${badge(r.estado)}</td><td><div class="table-actions">${actions || '<span class="muted">Proceso finalizado</span>'}</div></td></tr>`;
}

function renderReservationDialog() {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const available = state.mesas.filter((m) => !['ocupada', 'limpieza', 'fuera_servicio'].includes(m.estado));
  return `<dialog id="reservationDialog"><div class="dialog-header"><div><span class="eyebrow">NUEVA RESERVA</span><h2>Registrar una reserva</h2><p>Completa los datos en orden. Los campos opcionales pueden dejarse vacíos.</p></div><button class="dialog-close" onclick="closeDialog('reservationDialog')">×</button></div><form class="dialog-body guided-form" onsubmit="saveReservation(event)">
    <section class="flow-section"><div class="flow-section-title"><span>1</span><div><strong>Datos del cliente</strong><small>Cómo identificar y contactar la reserva</small></div></div><div class="form-grid"><div class="field span-2"><label>Nombre del cliente</label><input name="nombre" placeholder="Nombre completo" autocomplete="name" required></div><div class="field"><label>Teléfono</label><input name="telefono" placeholder="300 000 0000" inputmode="tel" autocomplete="tel" required></div><div class="field"><label>Documento <em>opcional</em></label><input name="documento"></div><div class="field span-2"><label>Correo <em>opcional</em></label><input name="correo" type="email" autocomplete="email"></div></div></section>
    <section class="flow-section"><div class="flow-section-title"><span>2</span><div><strong>Fecha, hora y mesa</strong><small>El sistema validará disponibilidad y capacidad</small></div></div><div class="form-grid"><div class="field span-2"><label>Mesa</label><select name="MesaId" required><option value="">Seleccionar mesa disponible</option>${available.map((m) => `<option value="${m.id}">Mesa ${m.numero} · máximo ${m.capacidad} personas · ${escapeHtml(m.zona || 'Salón')}</option>`).join('')}</select></div><div class="field"><label>Fecha</label><input name="fecha" type="date" min="${new Date().toISOString().slice(0, 10)}" value="${tomorrow}" required></div><div class="field"><label>Hora</label><input name="hora" type="time" value="19:00" required></div><div class="field"><label>Número de personas</label><input name="personas" type="number" min="1" value="2" required></div><div class="field"><label>Mesero responsable</label><select name="MeseroId"><option value="">Asignar después</option>${state.meseros.map((m) => `<option value="${m.id}">${escapeHtml(m.Usuario?.nombre || m.codigo)}</option>`).join('')}</select></div></div></section>
    <section class="flow-section"><div class="flow-section-title"><span>3</span><div><strong>Observaciones</strong><small>Alergias, celebración o ubicación preferida</small></div></div><div class="field"><label>Notas <em>opcional</em></label><textarea name="observaciones" placeholder="Ej. Cumpleaños, silla para bebé, alergia conocida..."></textarea></div></section>
    <div class="sticky-form-actions"><button type="button" class="btn btn-secondary" onclick="closeDialog('reservationDialog')">Cancelar</button><button class="btn btn-primary">Guardar reserva</button></div></form></dialog>`;
}
function prepareReservationForm() { openDialog('reservationDialog'); }

async function saveReservation(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const body = {
    MesaId: Number(values.MesaId),
    MeseroId: values.MeseroId ? Number(values.MeseroId) : null,
    personas: Number(values.personas),
    fecha: values.fecha,
    hora: values.hora,
    observaciones: values.observaciones,
    cliente: { nombre: values.nombre, telefono: values.telefono, documento: values.documento || null, correo: values.correo || null },
  };
  try { await api('/reservas', { method: 'POST', body: JSON.stringify(body) }); closeDialog('reservationDialog'); toast('Reserva creada correctamente.'); await renderReservas(); } catch (error) { toast(error.message, 'error'); }
}
async function confirmArrival(id) {
  if (!confirm('¿Confirmas que el cliente llegó y la mesa será ocupada?')) return;
  try { await api(`/reservas/${id}/llegada`, { method: 'POST' }); toast('Llegada confirmada. La mesa está ocupada.'); await renderReservas(); } catch (error) { toast(error.message, 'error'); }
}
async function cancelReservation(id) {
  const motivo = prompt('Escribe el motivo de la cancelación:');
  if (!motivo?.trim()) return;
  try { await api(`/reservas/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo: motivo.trim() }) }); toast('Reserva cancelada.', 'warning'); await renderReservas(); } catch (error) { toast(error.message, 'error'); }
}

async function completeReservation(id) {
  if (!confirm('¿Deseas terminar esta reserva? La mesa quedará en limpieza.')) return;
  try {
    await api(`/reservas/${id}/completar`, { method: 'POST' });
    toast('Reserva terminada correctamente. La mesa quedó en limpieza.');
    await renderReservas();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* Pedidos y platos */
async function renderPedidos() {
  const historyRequest = activeOrdersTab === 'historial'
    ? api(`/pedidos?fecha=${encodeURIComponent(orderHistoryDate)}`)
    : Promise.resolve([]);

  [state.pedidos, state.mesas, state.meseros, state.catalogo, state.metodosPago, state.reservas, state.historialPedidos, state.factus] = await Promise.all([
    api('/pedidos'),
    api('/mesas'),
    api('/meseros'),
    api('/catalogo'),
    ['administrador', 'despacho'].includes(user.rol) ? api('/metodos-pago') : Promise.resolve([]),
    api('/reservas'),
    historyRequest,
    ['administrador', 'despacho'].includes(user.rol)
      ? api('/facturacion/factus/estado').catch(() => ({ enabled: false, configured: false, environment: 'sandbox', missing: [] }))
      : Promise.resolve({ enabled: false, configured: false, environment: 'sandbox', missing: [] }),
  ]);

  const actions = ['administrador', 'mesero'].includes(user.rol) ? `<button class="btn btn-primary" onclick="prepareOrderForm()">+ ${user.rol === 'mesero' ? 'Tomar pedido' : 'Nuevo pedido'}</button>` : '';
  if (user.rol === 'mesero' && activeOrdersTab === 'platos') activeOrdersTab = 'pedidos';
  const tabContent = activeOrdersTab === 'platos'
    ? renderCatalogTab()
    : activeOrdersTab === 'historial'
      ? renderOrderHistoryTab()
      : renderOrdersTab();

  main().innerHTML = `
    ${pageHeading(user.rol === 'mesero' ? 'Pedidos' : 'Pedidos / Platos', user.rol === 'mesero' ? 'Toma pedidos y espera la notificación de despacho para recogerlos.' : user.rol === 'despacho' ? 'Consulta pedidos, cobros pendientes e historial diario.' : 'Registra pedidos por mesa, agrega adicionales y consulta el historial diario.', actions)}
    <div class="tabs">
      <button class="tab-button ${activeOrdersTab === 'pedidos' ? 'active' : ''}" onclick="setOrdersTab('pedidos')">${user.rol === 'mesero' ? 'Pedidos activos' : 'Pedidos registrados'}</button>
      <button class="tab-button ${activeOrdersTab === 'historial' ? 'active' : ''}" onclick="setOrdersTab('historial')">Historial por día</button>
      ${user.rol === 'administrador' ? `<button class="tab-button ${activeOrdersTab === 'platos' ? 'active' : ''}" onclick="setOrdersTab('platos')">Menú de platos</button>` : ''}
    </div>
    <div id="ordersTabContent">${tabContent}</div>
    ${renderOrderDialog()}
    ${renderAdditionalDialog()}
    ${renderPaymentDialog()}
    ${user.rol === 'administrador' ? renderDishDialog() : ''}
  `;
}

function setOrdersTab(tab) {
  activeOrdersTab = tab;
  renderPedidos();
}

function setOrderHistoryDate(value) {
  if (!value) return;
  orderHistoryDate = value;
  renderPedidos();
}

function moveOrderHistoryDate(days) {
  const date = new Date(`${orderHistoryDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  orderHistoryDate = localDateValue(date);
  renderPedidos();
}

function showTodayOrderHistory() {
  orderHistoryDate = localDateValue();
  renderPedidos();
}

function renderOrdersTab() {
  const pendingDishes = state.pedidos.flatMap((p) => p.detalles || []).filter((d) => !['preparado', 'cancelado'].includes(d.estado)).length;
  let orders = [...state.pedidos].reverse();

  if (user.rol === 'mesero') {
    if (waiterOrderView === 'attention') orders = orders.filter((p) => !['pagado', 'cancelado', 'rechazado'].includes(p.estado) && p.estado_pago !== 'pagado');
    if (waiterOrderView === 'ready') orders = orders.filter((p) => p.estado === 'en_entrega');
    if (waiterOrderView === 'unpaid') orders = orders.filter((p) => p.estado === 'entregado' && p.estado_pago !== 'pagado');
  }
  if (orderTableFilter) orders = orders.filter((p) => Number(p.MesaId) === Number(orderTableFilter));

  const filterBar = user.rol === 'mesero' ? `<section class="panel waiter-order-filters"><div class="status-filter-chips"><button class="filter-chip ${waiterOrderView === 'attention' ? 'active' : ''}" onclick="setWaiterOrderView('attention')">Necesitan atención</button><button class="filter-chip ${waiterOrderView === 'ready' ? 'active' : ''}" onclick="setWaiterOrderView('ready')">Listos para recoger</button><button class="filter-chip ${waiterOrderView === 'unpaid' ? 'active' : ''}" onclick="setWaiterOrderView('unpaid')">Entregados</button><button class="filter-chip ${waiterOrderView === 'all' ? 'active' : ''}" onclick="setWaiterOrderView('all')">Todos</button></div>${orderTableFilter ? `<button class="btn btn-secondary btn-sm" onclick="clearOrderTableFilter()">Mostrando Mesa ${state.mesas.find((m) => Number(m.id) === Number(orderTableFilter))?.numero || ''} · Quitar filtro</button>` : ''}</section>` : '';

  const emptyAction = ['administrador', 'mesero'].includes(user.rol) ? '<button class="btn btn-primary" onclick="prepareOrderForm()">Tomar pedido</button>' : '';
  return `${filterBar}<section class="stats-grid" style="grid-template-columns:repeat(3,minmax(160px,1fr))"><article class="stat-card"><span class="stat-icon">🧾</span><div><strong>${state.pedidos.length}</strong><small>Pedidos registrados</small></div></article><article class="stat-card"><span class="stat-icon">🍳</span><div><strong>${pendingDishes}</strong><small>Platos pendientes</small></div></article><article class="stat-card"><span class="stat-icon">✓</span><div><strong>${state.pedidos.filter((p) => p.estado_pago === 'pagado').length}</strong><small>Pedidos pagados</small></div></article></section><section class="order-grid">${orders.length ? orders.map((p) => renderOrderCard(p, 'orders')).join('') : emptyState('🧾', orderTableFilter ? 'Esta mesa no tiene pedidos visibles' : 'No hay pedidos en este filtro', orderTableFilter ? 'Quita el filtro o toma un nuevo pedido.' : 'Cambia el filtro o revisa otro día.', emptyAction)}</section>`;
}

function setWaiterOrderView(view) {
  waiterOrderView = view;
  const content = document.querySelector('#ordersTabContent');
  if (content) content.innerHTML = renderOrdersTab();
}

function clearOrderTableFilter() {
  orderTableFilter = null;
  const content = document.querySelector('#ordersTabContent');
  if (content) content.innerHTML = renderOrdersTab();
}

function renderOrderHistoryTab() {
  const orders = state.historialPedidos || [];
  const paidOrders = orders.filter((p) => p.estado_pago === 'pagado');
  const dishCount = orders.reduce((sum, p) => sum + (p.detalles || []).reduce((acc, d) => acc + Number(d.cantidad || 0), 0), 0);
  const paidTotal = paidOrders.reduce((sum, p) => sum + Number(p.total || 0), 0);

  return `
    <section class="panel history-filter-panel">
      <div class="history-toolbar">
        <div>
          <h2>Historial diario de pedidos</h2>
          <p>Consulta los pedidos según la fecha y revisa la hora exacta en que fueron creados.</p>
        </div>
        <div class="history-date-controls no-print">
          <button class="btn btn-secondary btn-sm" onclick="moveOrderHistoryDate(-1)">← Día anterior</button>
          <label class="history-date-field">Fecha<input type="date" value="${orderHistoryDate}" onchange="setOrderHistoryDate(this.value)"></label>
          <button class="btn btn-secondary btn-sm" onclick="showTodayOrderHistory()">Hoy</button>
          <button class="btn btn-secondary btn-sm" onclick="moveOrderHistoryDate(1)">Día siguiente →</button>
        </div>
      </div>
    </section>
    <section class="stats-grid history-stats">
      <article class="stat-card"><span class="stat-icon">▤</span><div><strong>${orders.length}</strong><small>Pedidos del día</small></div></article>
      <article class="stat-card"><span class="stat-icon">🍽</span><div><strong>${dishCount}</strong><small>Productos solicitados</small></div></article>
      <article class="stat-card"><span class="stat-icon">$</span><div><strong>${money(paidTotal)}</strong><small>Ventas pagadas</small></div></article>
    </section>
    <section class="panel">
      <div class="panel-header"><h2>Pedidos del ${formatDate(orderHistoryDate)}</h2><span>${orders.length} registros</span></div>
      ${orders.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Hora</th><th>Pedido</th><th>Mesa</th><th>Mesero</th><th>Productos</th><th>Estado</th><th>Pago</th><th>Total</th></tr></thead><tbody>${orders.map((p) => `<tr><td><strong>${formatTime(recordTimestamp(p))}</strong></td><td>${escapeHtml(p.numero)}</td><td>Mesa ${p.Mesa?.numero || '-'}</td><td>${escapeHtml(p.Mesero?.Usuario?.nombre || p.Mesero?.codigo || '-')}</td><td>${(p.detalles || []).reduce((sum, d) => sum + Number(d.cantidad || 0), 0)}</td><td>${badge(p.estado)}</td><td>${badge(p.estado_pago)}</td><td><strong>${money(p.total)}</strong></td></tr>`).join('')}</tbody></table></div>` : emptyState('▤', 'No hay pedidos en esta fecha', 'Selecciona otro día o crea un pedido nuevo.')}
    </section>
  `;
}

function renderOrderCard(pedido, mode) {
  const waiter = pedido.Mesero?.Usuario?.nombre || pedido.Mesero?.codigo || '-';
  const paid = pedido.estado_pago === 'pagado';
  const closed = paid || ['pagado', 'cancelado', 'rechazado'].includes(pedido.estado);
  let actions = '';
  let nextStep = 'Consulta el estado del pedido';

  if (pedido.estado === 'enviado_despacho') nextStep = 'Despacho debe confirmar el pedido';
  if (pedido.estado === 'confirmado_despacho') nextStep = 'Despacho lo enviará a cocina';
  if (pedido.estado === 'enviado_cocina') nextStep = 'Cocina aún no inicia la preparación';
  if (pedido.estado === 'en_preparacion') nextStep = 'Cocina está preparando los platos';
  if (pedido.estado === 'listo') nextStep = 'Despacho está revisando que el pedido esté completo';
  if (pedido.estado === 'en_entrega') nextStep = user.rol === 'mesero' ? 'Ve a despacho, recoge el pedido y entrégalo al cliente' : `El mesero ${waiter} ya fue notificado`;
  if (pedido.estado === 'entregado' && !paid) nextStep = user.rol === 'mesero' ? 'Entrega terminada; caja debe registrar el pago' : 'Registrar el pago en caja';
  if (paid) nextStep = 'Atención finalizada y pagada';

  if (['administrador', 'mesero'].includes(user.rol) && !closed) {
    actions += `<button class="btn btn-soft btn-sm" onclick="prepareAdditionalOrder(${pedido.id})">+ Agregar otro plato</button>`;
  }
  if (['administrador', 'mesero'].includes(user.rol) && pedido.estado === 'en_entrega') {
    actions = `<button class="btn btn-success" onclick="changeOrderState(${pedido.id},'entregado')">✓ Entregado al cliente</button>` + actions;
  }
  if (['administrador', 'despacho'].includes(user.rol) && pedido.estado === 'entregado' && !paid) {
    actions = `<button class="btn btn-primary" onclick="preparePayment(${pedido.id})">Cobrar ${money(pedido.total)}</button>` + actions;
  }
  if (paid && ['administrador', 'despacho'].includes(user.rol)) {
    const invoice = pedido.Factura;
    if (invoice?.proveedor === 'factus' && invoice?.estado_electronico === 'validada') {
      actions += `<button class="btn btn-secondary btn-sm" onclick="downloadFactusInvoice(${invoice.id},'pdf')">PDF electrónico</button>`;
      actions += `<button class="btn btn-secondary btn-sm" onclick="downloadFactusInvoice(${invoice.id},'xml')">XML</button>`;
      if (invoice.url_publica) actions += `<button class="btn btn-soft btn-sm" onclick="openFactusPublicUrl(${pedido.id})">Ver factura</button>`;
      actions += `<button class="btn btn-soft btn-sm" onclick="sendFactusInvoiceEmail(${invoice.id},${pedido.id})">Enviar por correo</button>`;
    } else {
      actions += `<button class="btn btn-secondary btn-sm" onclick="printInvoice(${pedido.id})">${invoice?.proveedor === 'factus_mock' ? 'Imprimir factura beta' : 'Imprimir comprobante'}</button>`;
    }
  }
  if (['administrador', 'mesero'].includes(user.rol) && !paid && !['cancelado', 'rechazado', 'entregado'].includes(pedido.estado)) actions += `<button class="btn btn-danger btn-sm secondary-danger-action" onclick="cancelOrder(${pedido.id})">Cancelar pedido</button>`;

  return `<article class="panel order-card ${pedido.estado === 'en_entrega' ? 'order-card-attention' : ''}">
    <div class="order-card-head">
      <div class="order-card-identity">
        <span class="order-table-kicker">MESA ${pedido.Mesa?.numero || '-'}</span>
        <h3>${escapeHtml(pedido.numero)}</h3>
        <div class="order-meta"><span><strong>Mesero:</strong> ${escapeHtml(waiter)}</span><span><strong>Fecha:</strong> ${formatDate(recordTimestamp(pedido))}</span><span class="order-created-time"><strong>Hora:</strong> ${formatTime(recordTimestamp(pedido))}</span></div>
      </div>
      <div class="order-status-wrap">${badge(pedido.estado)}</div>
    </div>
    <div class="next-step-banner"><span>→</span><div><small>Siguiente paso</small><strong>${nextStep}</strong></div></div>
    <div class="order-items">${(pedido.detalles || []).map((d) => `<div class="order-item"><span><strong>${d.cantidad} × ${escapeHtml(d.Plato?.nombre || 'Plato')}</strong><br><small>${escapeHtml(d.observaciones || 'Sin observaciones')} · Agregado ${formatTime(recordTimestamp(d))}</small></span><span class="order-item-status">${badge(d.estado)}</span></div>`).join('')}</div>
    <div class="order-total"><span>${badge(pedido.estado_pago)}</span><strong>${money(pedido.total)}</strong></div>
    ${pedido.Factura?.proveedor === 'factus' ? `<div class="electronic-invoice-summary"><span>Factura electrónica validada</span><strong>${escapeHtml(pedido.Factura.numero)}</strong>${pedido.Factura.cufe ? `<small>CUFE: ${escapeHtml(String(pedido.Factura.cufe).slice(0, 28))}…</small>` : ''}</div>` : pedido.Factura?.proveedor === 'factus_mock' ? `<div class="electronic-invoice-summary mock-invoice-summary"><span>Factura simulada · Beta</span><strong>${escapeHtml(pedido.Factura.numero)}</strong><small>No válida ante la DIAN</small></div>` : ''}
    ${actions ? `<div class="order-actions">${actions}</div>` : ''}
  </article>`;
}

function renderCatalogTab() {
  const adminActions = user.rol === 'administrador' ? '<button class="btn btn-primary" onclick="prepareDishForm()">+ Nuevo plato</button><button class="btn btn-secondary" onclick="createCategory()">+ Categoría</button>' : '';
  return `<div class="toolbar">${adminActions}</div><section class="panel"><div class="panel-header"><h2>Menú del restaurante</h2><span>${state.catalogo.platos.length} platos</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Código</th><th>Plato</th><th>Categoría</th><th>Precio</th><th>Impuesto</th><th>Preparación</th><th>Disponibilidad</th>${user.rol === 'administrador' ? '<th>Acciones</th>' : ''}</tr></thead><tbody>${state.catalogo.platos.map((p) => `<tr><td>${escapeHtml(p.codigo)}</td><td><strong>${escapeHtml(p.nombre)}</strong><br><small>${escapeHtml(p.descripcion || '')}</small></td><td>${escapeHtml(p.Categoria?.nombre || '-')}</td><td>${money(p.precio)}</td><td><strong>${escapeHtml(p.factus_tax_code || '01')}</strong><br><small>${p.factus_is_excluded ? 'Excluido' : `${Number(p.factus_tax_rate ?? 19)}%`}</small></td><td>${p.tiempo_preparacion} min</td><td>${badge(p.disponible ? 'activo' : 'inactivo')}</td>${user.rol === 'administrador' ? `<td><div class="table-actions"><button class="btn btn-secondary btn-sm" onclick="prepareDishForm(${p.id})">Editar</button><button class="btn ${p.disponible ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleDish(${p.id},${!p.disponible})">${p.disponible ? 'Agotar' : 'Activar'}</button></div></td>` : ''}</tr>`).join('')}</tbody></table></div></section>`;
}

function categoryOptionsMarkup() {
  return state.catalogo.categorias.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
}

function dishCategoryId(dish) {
  return Number(dish.CategoriaId ?? dish.Categoria?.id ?? dish.Categorium?.id ?? 0);
}

function dishOptionsMarkup(categoryId = '') {
  const dishes = state.catalogo.platos.filter((p) => p.disponible && (!categoryId || dishCategoryId(p) === Number(categoryId)));
  return `<option value="">${categoryId ? 'Seleccionar plato' : 'Primero elige una categoría'}</option>${dishes.map((p) => `<option value="${p.id}" data-price="${p.precio}">${escapeHtml(p.nombre)} · ${money(p.precio)}</option>`).join('')}`;
}

function normalizeDishCategoryName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function genericDishImage(dish) {
  const provided = String(dish?.imagen || '').trim();
  if (provided && !provided.toLowerCase().startsWith('javascript:')) return provided;
  const category = normalizeDishCategoryName(dish?.Categoria?.nombre);
  if (category.includes('entrada')) return 'assets/dishes/entradas.svg';
  if (category.includes('fuerte')) return 'assets/dishes/platos-fuertes.svg';
  if (category.includes('rapida')) return 'assets/dishes/comidas-rapidas.svg';
  if (category.includes('bebida')) return 'assets/dishes/bebidas.svg';
  if (category.includes('postre')) return 'assets/dishes/postres.svg';
  if (category.includes('adicional')) return 'assets/dishes/adicionales.svg';
  return 'assets/dishes/default.svg';
}

function availableDishCategories() {
  return state.catalogo.categorias.filter((category) => state.catalogo.platos.some((dish) => dish.disponible && dishCategoryId(dish) === Number(category.id)));
}

function initialDishCategory() {
  return availableDishCategories()[0]?.id || null;
}

function dishPickerMarkup(type, categoryId) {
  const categories = availableDishCategories();
  const selectedId = Number(categoryId || categories[0]?.id || 0);
  const dishes = state.catalogo.platos.filter((dish) => dish.disponible && dishCategoryId(dish) === selectedId);
  const prefix = type === 'additional' ? 'additional' : 'order';
  return `<div class="dish-picker">
    <div class="dish-category-heading"><strong>1. Elige una categoría</strong><small>Después toca el plato que quieres agregar.</small></div>
    <div class="dish-category-tabs" role="tablist" aria-label="Categorías del menú">
      ${categories.map((category) => `<button type="button" class="dish-category-tab ${Number(category.id) === selectedId ? 'active' : ''}" onclick="selectDishCategory('${prefix}',${category.id})">${escapeHtml(category.nombre)}</button>`).join('')}
    </div>
    <div class="dish-category-heading dish-list-heading"><strong>2. Selecciona un plato</strong><small>${dishes.length} opciones disponibles en esta categoría.</small></div>
    <div class="dish-picker-grid">
      ${dishes.length ? dishes.map((dish) => `<button type="button" class="dish-choice-card" onclick="addDishFromPicker('${prefix}',${dish.id})">
        <span class="dish-choice-image"><img src="${escapeHtml(genericDishImage(dish))}" alt="Imagen de ${escapeHtml(dish.nombre)}" onerror="this.onerror=null;this.src='assets/dishes/default.svg'"></span>
        <span class="dish-choice-copy"><strong>${escapeHtml(dish.nombre)}</strong><small>${escapeHtml(dish.descripcion || dish.Categoria?.nombre || 'Plato del menú')}</small><b>${money(dish.precio)}</b></span>
        <span class="dish-choice-add" aria-hidden="true">+</span>
      </button>`).join('') : `<div class="dish-picker-empty">No hay platos disponibles en esta categoría.</div>`}
    </div>
  </div>`;
}

function renderDishPicker(type) {
  const target = document.querySelector(type === 'additional' ? '#additionalDishPicker' : '#orderDishPicker');
  if (!target) return;
  const categoryId = type === 'additional' ? additionalPickerCategoryId : orderPickerCategoryId;
  target.innerHTML = dishPickerMarkup(type, categoryId);
}

function selectDishCategory(type, categoryId) {
  if (type === 'additional') additionalPickerCategoryId = Number(categoryId);
  else orderPickerCategoryId = Number(categoryId);
  renderDishPicker(type);
}

function selectedDishRowMarkup(dish, type) {
  const additional = type === 'additional';
  const rowClass = additional ? 'additional-item-row' : 'order-item-row';
  const quantityClass = additional ? 'additional-quantity' : 'item-quantity';
  const plateClass = additional ? 'additional-plate' : 'item-plate';
  const observationClass = additional ? 'additional-observation' : 'item-observation';
  const totalClass = additional ? 'additional-line-total' : 'item-line-total';
  return `<div class="selected-dish-row ${rowClass}" data-plate-id="${dish.id}" data-price="${Number(dish.precio)}">
    <input type="hidden" class="${plateClass}" value="${dish.id}">
    <img class="selected-dish-image" src="${escapeHtml(genericDishImage(dish))}" alt="Imagen de ${escapeHtml(dish.nombre)}" onerror="this.onerror=null;this.src='assets/dishes/default.svg'">
    <div class="selected-dish-copy"><strong>${escapeHtml(dish.nombre)}</strong><small>${escapeHtml(dish.Categoria?.nombre || 'Sin categoría')} · ${money(dish.precio)}</small><label>Observación <em>opcional</em><input class="${observationClass}" placeholder="Ej. sin cebolla, poca salsa..."></label></div>
    <div class="selected-dish-controls"><span>Cantidad</span><div class="quantity-stepper"><button type="button" onclick="adjustQuantity(this,-1,'${additional ? 'additional' : 'order'}')" aria-label="Restar uno">−</button><input class="${quantityClass}" type="number" min="1" value="1" required oninput="${additional ? 'calculateAdditionalEstimate()' : 'calculateOrderEstimate()'}"><button type="button" onclick="adjustQuantity(this,1,'${additional ? 'additional' : 'order'}')" aria-label="Sumar uno">+</button></div></div>
    <div class="selected-dish-total"><strong class="${totalClass}">${money(dish.precio)}</strong><button type="button" class="remove-item-button" onclick="${additional ? 'removeAdditionalItem(this)' : 'removeOrderItem(this)'}">Quitar</button></div>
  </div>`;
}

function addDishFromPicker(type, dishId) {
  const dish = state.catalogo.platos.find((item) => Number(item.id) === Number(dishId) && item.disponible);
  if (!dish) return toast('Este plato ya no está disponible.', 'warning');
  const container = document.querySelector(type === 'additional' ? '#additionalItems' : '#orderItems');
  if (!container) return;
  const existing = container.querySelector(`[data-plate-id="${dish.id}"]`);
  if (existing) {
    const input = existing.querySelector(type === 'additional' ? '.additional-quantity' : '.item-quantity');
    input.value = Number(input.value || 0) + 1;
    existing.classList.remove('dish-row-flash');
    requestAnimationFrame(() => existing.classList.add('dish-row-flash'));
  } else {
    container.insertAdjacentHTML('beforeend', selectedDishRowMarkup(dish, type));
  }
  if (type === 'additional') calculateAdditionalEstimate();
  else calculateOrderEstimate();
  updateSelectedDishCount(type);
}

function updateSelectedDishCount(type) {
  const container = document.querySelector(type === 'additional' ? '#additionalItems' : '#orderItems');
  const target = document.querySelector(type === 'additional' ? '#additionalItemCount' : '#orderItemCount');
  const empty = document.querySelector(type === 'additional' ? '#additionalItemsEmpty' : '#orderItemsEmpty');
  const count = container?.querySelectorAll(type === 'additional' ? '.additional-item-row' : '.order-item-row').length || 0;
  if (target) target.textContent = `${count} ${count === 1 ? 'plato' : 'platos'}`;
  if (empty) empty.hidden = count > 0;
}

function renderOrderDialog() {
  const occupied = state.mesas.filter((m) => m.estado === 'ocupada' && m.activo);
  return `<dialog id="orderDialog" class="dialog-lg order-dialog-wide"><div class="dialog-header"><div><span class="eyebrow">TOMAR PEDIDO</span><h2>Nuevo pedido</h2><p>Elige la mesa, selecciona una categoría y toca los platos para agregarlos.</p></div><button class="dialog-close" onclick="closeDialog('orderDialog')">×</button></div><form id="orderForm" class="dialog-body guided-form order-guided-form" onsubmit="saveOrder(event)">
    <section class="flow-section"><div class="flow-section-title"><span>1</span><div><strong>Selecciona la mesa</strong><small>Solo aparecen mesas ocupadas</small></div></div><div class="form-grid"><div class="field ${user.rol === 'mesero' ? 'span-2' : ''}"><label>Mesa que estás atendiendo</label><select name="MesaId" required onchange="updateOrderReservation(this.value); updateOrderTableSummary(this)"><option value="">Seleccionar mesa</option>${occupied.map((m) => `<option value="${m.id}">Mesa ${m.numero} · ${escapeHtml(m.zona || 'Salón')} · ${m.capacidad} personas</option>`).join('')}</select><small class="field-help">Si no aparece, primero debes ocuparla desde el módulo Mesas.</small></div>${user.rol === 'mesero' ? '<select name="MeseroId" class="hidden" disabled><option value=""></option></select>' : `<div class="field"><label>Mesero responsable</label><select name="MeseroId" required><option value="">Seleccionar mesero</option>${state.meseros.map((m) => `<option value="${m.id}">${escapeHtml(m.Usuario?.nombre || m.codigo)}</option>`).join('')}</select></div>`}</div><input type="hidden" name="ReservaId"><input type="hidden" name="ClienteId"></section>
    <section class="flow-section dish-selection-section"><div class="flow-section-title"><span>2</span><div><strong>Selecciona los platos</strong><small>Están organizados por categoría y cada uno tiene una imagen de referencia</small></div></div><div id="orderDishPicker"></div><div class="selected-order-panel"><div class="selected-order-header"><div><strong>Pedido seleccionado</strong><small>Puedes cambiar cantidades y agregar observaciones.</small></div><span id="orderItemCount" class="selected-count">0 platos</span></div><div id="orderItemsEmpty" class="selected-items-empty">Toca un plato de arriba para agregarlo al pedido.</div><div id="orderItems" class="selected-dish-list"></div></div></section>
    <section class="flow-section"><div class="flow-section-title"><span>3</span><div><strong>Revisa y envía</strong><small>Agrega una nota general solo si es necesaria</small></div></div><div class="field"><label>Nota general para cocina <em>opcional</em></label><textarea name="notas_cocina" placeholder="Ej. Todos los platos salen juntos; cliente con alergia..."></textarea></div><div class="summary-box order-sticky-summary"><div class="summary-row"><span id="orderTableSummary">Mesa sin seleccionar</span><strong id="orderSubtotal">${money(0)}</strong></div><div class="summary-row"><span>IVA estimado (19%)</span><strong id="orderTax">${money(0)}</strong></div><div class="summary-row summary-total"><span>Total estimado</span><strong id="orderTotalEstimate">${money(0)}</strong></div><small>El servidor recalculará todos los valores usando MySQL.</small></div></section>
    <div class="sticky-form-actions"><button type="button" class="btn btn-secondary" onclick="closeDialog('orderDialog')">Cancelar</button><button id="saveOrderButton" class="btn btn-primary" ${occupied.length ? '' : 'disabled'}>Enviar pedido a despacho</button></div>${occupied.length ? '' : '<p class="form-alert">No hay mesas ocupadas. Ve a Mesas y ocupa una antes de tomar el pedido.</p>'}</form></dialog>`;
}

function prepareOrderForm(mesaId = null) {
  const form = document.querySelector('#orderForm');
  if (!form) return;
  form.reset();
  document.querySelector('#orderItems').innerHTML = '';
  orderPickerCategoryId = initialDishCategory();
  renderDishPicker('order');
  updateSelectedDishCount('order');
  if (mesaId) {
    form.MesaId.value = String(mesaId);
    updateOrderReservation(mesaId);
    updateOrderTableSummary(form.MesaId);
  } else {
    updateOrderTableSummary(form.MesaId);
  }
  calculateOrderEstimate();
  openDialog('orderDialog');
}

function addOrderItem() {
  renderDishPicker('order');
}

function filterOrderPlateOptions(categorySelect) {
  selectDishCategory('order', categorySelect.value);
}

function adjustQuantity(button, delta, type) {
  const row = button.closest(type === 'additional' ? '.additional-item-row' : '.order-item-row');
  const input = row.querySelector(type === 'additional' ? '.additional-quantity' : '.item-quantity');
  input.value = Math.max(1, Number(input.value || 1) + delta);
  type === 'additional' ? calculateAdditionalEstimate() : calculateOrderEstimate();
}

function removeOrderItem(button) {
  button.closest('.order-item-row')?.remove();
  calculateOrderEstimate();
  updateSelectedDishCount('order');
}

function calculateOrderEstimate() {
  let subtotal = 0;
  document.querySelectorAll('.order-item-row').forEach((row) => {
    const lineTotal = Number(row.dataset.price || 0) * Number(row.querySelector('.item-quantity').value || 0);
    subtotal += lineTotal;
    const target = row.querySelector('.item-line-total');
    if (target) target.textContent = money(lineTotal);
  });
  const tax = Math.round(subtotal * 0.19 * 100) / 100;
  const target = document.querySelector('#orderSubtotal');
  const taxTarget = document.querySelector('#orderTax');
  const totalTarget = document.querySelector('#orderTotalEstimate');
  if (target) target.textContent = money(subtotal);
  if (taxTarget) taxTarget.textContent = money(tax);
  if (totalTarget) totalTarget.textContent = money(subtotal + tax);
  updateSelectedDishCount('order');
}

function updateOrderTableSummary(select) {
  const target = document.querySelector('#orderTableSummary');
  if (target) target.textContent = select?.selectedOptions?.[0]?.textContent || 'Mesa sin seleccionar';
}
function updateOrderReservation(mesaId) {
  const form = document.querySelector('#orderForm');
  const reservation = state.reservas.find((r) => Number(r.MesaId) === Number(mesaId) && r.estado === 'cliente_presente');
  form.ReservaId.value = reservation?.id || '';
  form.ClienteId.value = reservation?.ClienteId || '';
}

async function saveOrder(event) {
  event.preventDefault();
  const form = event.target;
  const rows = [...form.querySelectorAll('.order-item-row')];
  const items = rows.map((row) => ({
    PlatoId: Number(row.querySelector('.item-plate').value),
    cantidad: Number(row.querySelector('.item-quantity').value),
    observaciones: row.querySelector('.item-observation').value.trim(),
  }));
  if (!form.MesaId.value) return toast('Selecciona la mesa que estás atendiendo.', 'warning');
  if (!items.length || items.some((item) => !item.PlatoId || item.cantidad < 1)) return toast('Revisa que todos los platos y cantidades estén completos.', 'warning');

  const body = {
    MesaId: Number(form.MesaId.value),
    ReservaId: form.ReservaId.value ? Number(form.ReservaId.value) : null,
    ClienteId: form.ClienteId.value ? Number(form.ClienteId.value) : null,
    MeseroId: form.MeseroId.disabled ? null : Number(form.MeseroId.value),
    notas_cocina: form.notas_cocina.value,
    items,
  };
  const submit = document.querySelector('#saveOrderButton');
  const originalText = submit?.textContent;
  if (submit) { submit.disabled = true; submit.textContent = 'Enviando pedido...'; }
  try {
    await api('/pedidos', { method: 'POST', body: JSON.stringify(body) });
    closeDialog('orderDialog');
    toast('Pedido enviado. Puedes seguir su estado desde esta pantalla.');
    activeOrdersTab = 'pedidos';
    waiterOrderView = 'attention';
    await renderPedidos();
  } catch (error) {
    toast(error.message, 'error');
    if (submit) { submit.disabled = false; submit.textContent = originalText; }
  }
}

function renderAdditionalDialog() {
  return `<dialog id="additionalDialog" class="dialog-lg order-dialog-wide"><div class="dialog-header"><div><span class="eyebrow">AGREGAR AL PEDIDO</span><h2>Agregar otros platos</h2><p id="additionalOrderLabel">Usa esta opción cuando el cliente pide algo después.</p></div><button class="dialog-close" onclick="closeDialog('additionalDialog')" aria-label="Cerrar">×</button></div><form id="additionalForm" class="dialog-body guided-form" onsubmit="saveAdditionalItems(event)"><input type="hidden" name="PedidoId"><div class="additional-order-summary"><span>Pedido actual</span><strong id="additionalCurrentTotal">$0</strong></div><section class="flow-section dish-selection-section"><div class="flow-section-title"><span>1</span><div><strong>Selecciona los productos nuevos</strong><small>Elige una categoría y toca los platos adicionales</small></div></div><div id="additionalDishPicker"></div><div class="selected-order-panel"><div class="selected-order-header"><div><strong>Adicionales seleccionados</strong><small>Revisa cantidades y observaciones.</small></div><span id="additionalItemCount" class="selected-count">0 platos</span></div><div id="additionalItemsEmpty" class="selected-items-empty">Toca un plato de arriba para agregarlo.</div><div id="additionalItems" class="selected-dish-list"></div></div></section><section class="flow-section"><div class="flow-section-title"><span>2</span><div><strong>Confirma el adicional</strong><small>Volverá a despacho y cocina sin alterar los productos anteriores</small></div></div><div class="summary-box"><div class="summary-row"><span>Subtotal adicional</span><strong id="additionalSubtotal">${money(0)}</strong></div><div class="summary-row"><span>IVA estimado (19%)</span><strong id="additionalTax">${money(0)}</strong></div><div class="summary-row summary-total"><span>Total adicional</span><strong id="additionalTotalEstimate">${money(0)}</strong></div><small>El backend recalculará el nuevo total con los precios de MySQL.</small></div></section><div class="sticky-form-actions"><button type="button" class="btn btn-secondary" onclick="closeDialog('additionalDialog')">Cancelar</button><button class="btn btn-primary">Enviar adicionales</button></div></form></dialog>`;
}

function prepareAdditionalOrder(id) {
  const pedido = state.pedidos.find((item) => item.id === id);
  if (!pedido) return toast('No se encontró el pedido.', 'error');
  if (pedido.estado_pago === 'pagado' || ['pagado', 'cancelado', 'rechazado'].includes(pedido.estado)) {
    return toast('El pedido ya está cerrado y no admite adicionales.', 'warning');
  }

  const form = document.querySelector('#additionalForm');
  form.reset();
  form.PedidoId.value = pedido.id;
  document.querySelector('#additionalOrderLabel').textContent = `${pedido.numero} · Mesa ${pedido.Mesa?.numero || '-'}`;
  document.querySelector('#additionalCurrentTotal').textContent = `Total actual: ${money(pedido.total)}`;
  document.querySelector('#additionalItems').innerHTML = '';
  additionalPickerCategoryId = initialDishCategory();
  renderDishPicker('additional');
  updateSelectedDishCount('additional');
  calculateAdditionalEstimate();
  openDialog('additionalDialog');
}

function addAdditionalItem() {
  renderDishPicker('additional');
}

function filterAdditionalPlateOptions(categorySelect) {
  selectDishCategory('additional', categorySelect.value);
}

function removeAdditionalItem(button) {
  button.closest('.additional-item-row')?.remove();
  calculateAdditionalEstimate();
  updateSelectedDishCount('additional');
}

function calculateAdditionalEstimate() {
  let subtotal = 0;
  document.querySelectorAll('.additional-item-row').forEach((row) => {
    const lineTotal = Number(row.dataset.price || 0) * Number(row.querySelector('.additional-quantity').value || 0);
    subtotal += lineTotal;
    const target = row.querySelector('.additional-line-total');
    if (target) target.textContent = money(lineTotal);
  });
  const tax = Math.round(subtotal * 0.19 * 100) / 100;
  const target = document.querySelector('#additionalSubtotal');
  const taxTarget = document.querySelector('#additionalTax');
  const totalTarget = document.querySelector('#additionalTotalEstimate');
  if (target) target.textContent = money(subtotal);
  if (taxTarget) taxTarget.textContent = money(tax);
  if (totalTarget) totalTarget.textContent = money(subtotal + tax);
  updateSelectedDishCount('additional');
}

async function saveAdditionalItems(event) {
  event.preventDefault();
  const form = event.target;
  const items = [...form.querySelectorAll('.additional-item-row')].map((row) => ({
    PlatoId: Number(row.querySelector('.additional-plate').value),
    cantidad: Number(row.querySelector('.additional-quantity').value),
    observaciones: row.querySelector('.additional-observation').value.trim(),
  }));
  if (!items.length || items.some((item) => !item.PlatoId || item.cantidad < 1)) {
    return toast('Selecciona por lo menos un plato adicional.', 'warning');
  }

  try {
    await api(`/pedidos/${form.PedidoId.value}/items`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
    closeDialog('additionalDialog');
    toast('Productos adicionales agregados y enviados a despacho.');
    activeOrdersTab = 'pedidos';
    await renderPedidos();
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderPaymentDialog() {
  const factusReady = Boolean(state.factus?.configured);
  const mockMode = Boolean(state.factus?.mock_mode);
  const factusLabel = mockMode
    ? 'Factus simulado · Beta'
    : factusReady
      ? `Factus ${state.factus.environment === 'production' ? 'Producción' : 'Sandbox'}`
      : state.factus?.enabled ? 'Factus incompleto' : 'Factus desactivado';
  const factusHelp = mockMode
    ? 'Genera un documento de demostración guardado en MySQL. No se conecta a Factus ni tiene validez ante la DIAN.'
    : factusReady
      ? 'La factura será enviada a Factus y el pago solo se registrará cuando quede validada.'
      : 'Configura las credenciales de Factus en backend/.env para habilitar la factura electrónica.';
  const factusTitle = mockMode ? 'Generar factura simulada para la beta' : 'Emitir factura electrónica con Factus';

  return `<dialog id="paymentDialog" class="dialog-lg"><div class="dialog-header"><div><h2>Registrar pago</h2><p id="paymentOrderLabel">Cuenta del pedido</p></div><button class="dialog-close" onclick="closeDialog('paymentDialog')">×</button></div><form id="paymentForm" class="dialog-body" onsubmit="savePayment(event)"><input type="hidden" name="PedidoId"><input type="hidden" name="consumo_base">
    <section class="billing-summary-card">
      <div class="billing-summary-row"><span>Consumo antes de IVA</span><strong id="paymentSubtotal">$0</strong></div>
      <div class="billing-summary-row"><span>IVA (19%)</span><strong id="paymentTax">$0</strong></div>
      <div class="billing-summary-row"><span>Descuento</span><strong id="paymentDiscount">$0</strong></div>
      <div class="billing-summary-row billing-consumption-total"><span>Total del consumo</span><strong id="paymentConsumptionTotal">$0</strong></div>
      <label class="tip-choice"><input id="includeTip" type="checkbox" onchange="syncTipCalculation()"><span><strong>Incluir propina voluntaria sugerida del 10%</strong><small>Pregunta al cliente antes de marcarla. Puede aceptar o rechazarla libremente.</small></span><strong id="paymentTip">$0</strong></label>
      <div class="billing-summary-row billing-grand-total"><span>Total a pagar</span><strong id="paymentGrandTotal">$0</strong></div>
    </section>
    <div class="form-grid"><div class="field"><label>Total de la cuenta</label><input name="total" readonly></div><div class="field"><label>Valor recibido</label><input name="valor" type="number" min="0" step="0.01" required></div><div class="field"><label for="paymentMethod">Método de pago</label><select id="paymentMethod" name="MetodoPagoId" onchange="syncPaymentReferenceRequirement()" required>${state.metodosPago.map((m) => `<option value="${m.id}">${escapeHtml(m.nombre)}</option>`).join('')}</select></div><div class="field"><label for="paymentReference">Referencia del pago</label><input id="paymentReference" name="referencia" maxlength="100" autocomplete="off"><small id="paymentReferenceHelp" class="field-help">No aplica para pagos en efectivo.</small></div></div>
    <section class="factus-box ${factusReady ? 'factus-ready' : 'factus-disabled'} ${mockMode ? 'factus-mock' : ''}">
      <label class="factus-toggle"><input id="emitirFactus" name="emitir_factus" type="checkbox" onchange="syncFactusOptions()" ${factusReady ? '' : 'disabled'}><span><strong>${escapeHtml(factusTitle)}</strong><small>${escapeHtml(factusHelp)}</small></span></label>
      <span class="factus-environment">${escapeHtml(factusLabel)}</span>
    </section>
    ${mockMode ? '<div class="beta-invoice-notice">FACTURA SIMULADA — BETA — NO VÁLIDA ANTE LA DIAN</div>' : ''}
    <section id="factusFields" class="factus-fields" hidden>
      <div class="form-grid">
        <div class="field"><label for="factusPaymentCode">Medio de pago DIAN</label><select id="factusPaymentCode" name="factus_payment_method_code"><option value="10">Efectivo</option><option value="47">Transferencia</option><option value="48">Tarjeta de crédito</option><option value="49">Tarjeta débito</option><option value="42">Consignación</option><option value="20">Cheque</option><option value="ZZZ">Otro</option></select></div>
        <div class="field factus-check-field"><label><input id="consumerFinal" type="checkbox" checked onchange="syncFactusCustomerFields()"> Facturar como consumidor final</label><small>Úsalo cuando el cliente no solicita la factura a su nombre.</small></div>
      </div>
      <div id="factusCustomerFields" hidden>
        <div class="factus-section-title"><div><strong>Datos fiscales del cliente</strong><small>Completa la información del adquiriente.</small></div></div>
        <div class="form-grid">
          <div class="field"><label>Tipo de documento</label><select id="factusDocumentType"><option value="13">Cédula de ciudadanía</option><option value="31">NIT</option><option value="22">Cédula de extranjería</option><option value="41">Pasaporte</option><option value="50">NIT de otro país</option></select></div>
          <div class="field"><label>Número de identificación</label><input id="factusIdentification" inputmode="numeric" maxlength="30"></div>
          <div class="field"><label>Tipo de persona</label><select id="factusLegalOrganization" onchange="syncFactusLegalOrganization()"><option value="2">Persona natural</option><option value="1">Persona jurídica</option></select></div>
          <div class="field"><label>Responsabilidad tributaria</label><select id="factusTribute"><option value="ZZ">No responsable de IVA</option><option value="01">Responsable de IVA</option></select></div>
          <div id="factusNaturalNameField" class="field span-2"><label>Nombre completo</label><input id="factusNames" maxlength="160"></div>
          <div id="factusCompanyField" class="field span-2" hidden><label>Razón social</label><input id="factusCompany" maxlength="160"></div>
          <div class="field"><label>Correo</label><input id="factusEmail" type="email" maxlength="120"></div>
          <div class="field"><label>Teléfono</label><input id="factusPhone" maxlength="30"></div>
          <div class="field span-2"><label>Dirección</label><input id="factusAddress" maxlength="180"></div>
          <div class="field"><label>Código de municipio DIAN</label><input id="factusMunicipality" maxlength="10" placeholder="Ej. 68001"></div>
          <div class="field factus-check-field"><label><input id="factusSendEmail" type="checkbox" ${mockMode ? 'disabled' : ''}> Enviar factura al correo</label><small>${mockMode ? 'El modo beta no envía correos externos.' : 'Factus enviará el documento después de validarlo.'}</small></div>
        </div>
      </div>
      <p class="factus-warning">IVA configurado en 19%. Antes de emitir documentos reales, valida la tributación de cada producto con el contador.</p>
    </section>
    <div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeDialog('paymentDialog')">Cancelar</button><button class="btn btn-primary">Confirmar pago</button></div></form></dialog>`;
}

function defaultFactusPaymentCode() {
  const form = document.querySelector('#paymentForm');
  if (!form) return 'ZZZ';
  const method = state.metodosPago.find((item) => Number(item.id) === Number(form.MetodoPagoId.value));
  const name = String(method?.nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (name.includes('efectivo')) return '10';
  if (name.includes('transferencia')) return '47';
  if (name.includes('tarjeta')) return '48';
  if (name.includes('consignacion')) return '42';
  if (name.includes('cheque')) return '20';
  return 'ZZZ';
}

function syncPaymentReferenceRequirement() {
  const form = document.querySelector('#paymentForm');
  if (!form) return;
  const methodId = Number(form.MetodoPagoId.value);
  const method = state.metodosPago.find((item) => item.id === methodId);
  const methodName = String(method?.nombre || '').toLowerCase();
  const reference = form.referencia;
  const help = document.querySelector('#paymentReferenceHelp');
  const cash = methodName.includes('efectivo');
  const requiresReference = /tarjeta|transferencia|mixto/.test(methodName);

  reference.disabled = cash;
  reference.required = requiresReference;
  if (cash) {
    reference.value = '';
    reference.placeholder = 'No aplica para efectivo';
    if (help) help.textContent = 'Para efectivo el reporte mostrará “No aplica”.';
  } else {
    reference.placeholder = requiresReference ? 'Número de autorización o comprobante' : 'Comprobante o referencia (opcional)';
    if (help) help.textContent = requiresReference ? 'Este dato es obligatorio para el método seleccionado.' : 'Registra el comprobante cuando exista.';
  }
  const factusCode = document.querySelector('#factusPaymentCode');
  if (factusCode) factusCode.value = defaultFactusPaymentCode();
}

function syncFactusOptions() {
  const enabled = Boolean(document.querySelector('#emitirFactus')?.checked);
  const fields = document.querySelector('#factusFields');
  if (fields) fields.hidden = !enabled;
  if (enabled) {
    const code = document.querySelector('#factusPaymentCode');
    if (code) code.value = defaultFactusPaymentCode();
    syncFactusCustomerFields();
  }
}

function syncFactusCustomerFields() {
  const consumerFinal = Boolean(document.querySelector('#consumerFinal')?.checked);
  const fields = document.querySelector('#factusCustomerFields');
  if (fields) fields.hidden = consumerFinal;
  const sendEmail = document.querySelector('#factusSendEmail');
  if (sendEmail && consumerFinal) sendEmail.checked = false;
  syncFactusLegalOrganization();
}

function syncFactusLegalOrganization() {
  const legal = document.querySelector('#factusLegalOrganization')?.value || '2';
  const natural = document.querySelector('#factusNaturalNameField');
  const company = document.querySelector('#factusCompanyField');
  if (natural) natural.hidden = legal === '1';
  if (company) company.hidden = legal !== '1';
}

function syncTipCalculation() {
  const form = document.querySelector('#paymentForm');
  if (!form) return;
  const consumption = Number(form.consumo_base.value || 0);
  const includeTip = Boolean(document.querySelector('#includeTip')?.checked);
  const tip = Math.round(consumption * 0.10 * 100) / 100;
  const appliedTip = includeTip ? tip : 0;
  const total = Math.round((consumption + appliedTip) * 100) / 100;
  const tipTarget = document.querySelector('#paymentTip');
  const totalTarget = document.querySelector('#paymentGrandTotal');
  if (tipTarget) tipTarget.textContent = money(appliedTip);
  if (totalTarget) totalTarget.textContent = money(total);
  form.total.value = money(total);
  form.valor.value = total.toFixed(2);
}

function preparePayment(id) {
  const pedido = state.pedidos.find((p) => p.id === id);
  const form = document.querySelector('#paymentForm');
  if (!pedido || !form) return;
  form.reset();
  form.PedidoId.value = id;
  const consumption = Math.round((Number(pedido.subtotal || 0) + Number(pedido.impuestos || 0) - Number(pedido.descuento || 0)) * 100) / 100;
  form.consumo_base.value = consumption.toFixed(2);
  const includeTip = document.querySelector('#includeTip');
  if (includeTip) includeTip.checked = false;
  const emitirFactus = document.querySelector('#emitirFactus');
  if (emitirFactus) emitirFactus.checked = Boolean(state.factus?.mock_mode);
  document.querySelector('#paymentSubtotal').textContent = money(pedido.subtotal);
  document.querySelector('#paymentTax').textContent = money(pedido.impuestos);
  document.querySelector('#paymentDiscount').textContent = money(pedido.descuento);
  document.querySelector('#paymentConsumptionTotal').textContent = money(consumption);
  document.querySelector('#paymentOrderLabel').textContent = `${pedido.numero} · Mesa ${pedido.Mesa?.numero || '-'}`;

  const client = pedido.Cliente || {};
  const consumerFinal = document.querySelector('#consumerFinal');
  if (consumerFinal) consumerFinal.checked = !client.documento;
  const assignments = {
    factusIdentification: client.documento || '',
    factusNames: client.nombre || '',
    factusCompany: client.razon_social || '',
    factusEmail: client.correo || '',
    factusPhone: client.telefono || '',
    factusAddress: client.direccion || '',
    factusMunicipality: client.municipio_codigo || '',
    factusDocumentType: client.tipo_documento_codigo || '13',
    factusLegalOrganization: client.organizacion_legal_codigo || '2',
    factusTribute: client.tributo_codigo || 'ZZ',
  };
  for (const [elementId, value] of Object.entries(assignments)) {
    const element = document.querySelector(`#${elementId}`);
    if (element) element.value = String(value);
  }
  openDialog('paymentDialog');
  syncTipCalculation();
  syncPaymentReferenceRequirement();
  syncFactusOptions();
}

function collectFactusCustomer() {
  const consumerFinal = Boolean(document.querySelector('#consumerFinal')?.checked);
  if (consumerFinal) return { consumidor_final: true };
  return {
    consumidor_final: false,
    identification_document_code: document.querySelector('#factusDocumentType')?.value,
    identification: document.querySelector('#factusIdentification')?.value.trim(),
    legal_organization_code: document.querySelector('#factusLegalOrganization')?.value,
    tribute_code: document.querySelector('#factusTribute')?.value,
    names: document.querySelector('#factusNames')?.value.trim(),
    company: document.querySelector('#factusCompany')?.value.trim(),
    email: document.querySelector('#factusEmail')?.value.trim(),
    phone: document.querySelector('#factusPhone')?.value.trim(),
    address: document.querySelector('#factusAddress')?.value.trim(),
    country_code: 'CO',
    municipality_code: document.querySelector('#factusMunicipality')?.value.trim(),
  };
}

async function savePayment(event) {
  event.preventDefault();
  const form = event.target;
  const emitirFactus = Boolean(document.querySelector('#emitirFactus')?.checked);
  const consumerFinal = Boolean(document.querySelector('#consumerFinal')?.checked);
  const body = {
    valor: Number(form.valor.value),
    MetodoPagoId: Number(form.MetodoPagoId.value),
    referencia: form.referencia.disabled ? '' : form.referencia.value.trim(),
    emitir_factus: emitirFactus,
    incluir_propina: Boolean(document.querySelector('#includeTip')?.checked),
  };
  if (emitirFactus) {
    body.factus_payment_method_code = document.querySelector('#factusPaymentCode')?.value || defaultFactusPaymentCode();
    body.factus_customer = collectFactusCustomer();
    body.enviar_email = !consumerFinal && Boolean(document.querySelector('#factusSendEmail')?.checked);
  }

  const submit = form.querySelector('button[type="submit"], button:not([type])');
  const originalText = submit?.textContent;
  const mockMode = Boolean(state.factus?.mock_mode);
  if (submit) { submit.disabled = true; submit.textContent = emitirFactus ? (mockMode ? 'Generando factura beta…' : 'Validando con Factus…') : 'Registrando pago…'; }
  try {
    const result = await api(`/pedidos/${form.PedidoId.value}/pagar`, { method: 'POST', body: JSON.stringify(body) });
    closeDialog('paymentDialog');
    if (result.factura?.proveedor === 'factus_mock') toast(`Factura simulada ${result.factura.numero} generada. No es válida ante la DIAN.`);
    else if (result.factura?.proveedor === 'factus') toast(`Factura electrónica ${result.factura.numero} validada correctamente.`);
    else toast('Pago y comprobante registrados. La mesa quedó en limpieza.');
    await renderPedidos();
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = originalText; }
  }
}

function downloadFactusInvoice(invoiceId, type) {
  const url = `${API_BASE}/facturas/${Number(invoiceId)}/${type === 'xml' ? 'xml' : 'pdf'}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openFactusPublicUrl(pedidoId) {
  const pedido = state.pedidos.find((item) => Number(item.id) === Number(pedidoId));
  const raw = pedido?.Factura?.url_publica;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('URL insegura');
    window.open(url.href, '_blank', 'noopener,noreferrer');
  } catch (_) {
    toast('La dirección pública de la factura no es válida.', 'error');
  }
}

async function sendFactusInvoiceEmail(invoiceId, pedidoId) {
  const pedido = state.pedidos.find((item) => Number(item.id) === Number(pedidoId));
  const email = prompt('Correo al que se enviará la factura electrónica:', pedido?.Cliente?.correo || '');
  if (!email?.trim()) return;
  try {
    await api(`/facturas/${invoiceId}/enviar-correo`, { method: 'POST', body: JSON.stringify({ email: email.trim() }) });
    toast('Factura electrónica enviada al correo.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function renderDishDialog() {
  const categoryOptions = state.catalogo.categorias.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
  return `<dialog id="dishDialog" class="dialog-lg"><div class="dialog-header"><div><h2 id="dishDialogTitle">Nuevo plato</h2><p>Configura el menú y los datos tributarios usados en Factus.</p></div><button class="dialog-close" onclick="closeDialog('dishDialog')">×</button></div><form id="dishForm" class="dialog-body" onsubmit="saveDish(event)"><input type="hidden" name="id"><div class="form-grid"><div class="field"><label for="dishCode">Código</label><input id="dishCode" name="codigo" required></div><div class="field"><label for="dishName">Nombre</label><input id="dishName" name="nombre" required></div><div class="field"><label for="dishCategory">Categoría</label><select id="dishCategory" name="CategoriaId" required><option value="">Seleccionar categoría</option>${categoryOptions}</select></div><div class="field"><label for="dishPrice">Precio antes de impuesto</label><input id="dishPrice" name="precio" type="number" min="0" step="0.01" required><small class="field-help">Factus calcula el impuesto con la tarifa configurada abajo.</small></div><div class="field"><label for="dishTime">Preparación (minutos)</label><input id="dishTime" name="tiempo_preparacion" type="number" min="1" value="15" required></div><div class="field"><label for="dishAvailable">Disponible</label><select id="dishAvailable" name="disponible"><option value="true">Sí</option><option value="false">No / agotado</option></select></div><div class="field span-2"><label for="dishDescription">Descripción</label><textarea id="dishDescription" name="descripcion"></textarea></div></div>
    <section class="factus-product-section"><div class="factus-section-title"><div><strong>Configuración tributaria</strong><small>Estos datos se guardan con cada producto y se copian al pedido.</small></div></div><div class="form-grid"><div class="field"><label>Impuesto</label><select name="factus_tax_code"><option value="01">01 · IVA</option><option value="04">04 · Impuesto Nacional al Consumo</option><option value="35">35 · Alimentos ultraprocesados</option></select></div><div class="field"><label>Tarifa (%)</label><input name="factus_tax_rate" type="number" min="0" max="100" step="0.01" value="19"></div><div class="field"><label>Unidad de medida Factus</label><input name="factus_unit_measure_code" value="94" maxlength="10"></div><div class="field"><label>Código estándar</label><input name="factus_standard_code" value="999" maxlength="10"></div><div class="field span-2 factus-check-field"><label><input name="factus_is_excluded" type="checkbox"> Producto excluido del impuesto</label><small>Confirma esta opción con el contador del restaurante.</small></div></div></section>
    ${state.catalogo.categorias.length ? '' : '<p class="form-alert">Primero debes crear una categoría.</p>'}<div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeDialog('dishDialog')">Cancelar</button><button class="btn btn-primary" ${state.catalogo.categorias.length ? '' : 'disabled'}>Guardar plato</button></div></form></dialog>`;
}
function prepareDishForm(id = null) {
  const form = document.querySelector('#dishForm');
  form.reset();
  form.id.value = '';
  document.querySelector('#dishDialogTitle').textContent = id ? 'Editar plato' : 'Nuevo plato';
  if (id) {
    const dish = state.catalogo.platos.find((p) => p.id === id);
    if (!dish) return toast('No se encontró el plato seleccionado.', 'error');
    const categoryId = dish.CategoriaId ?? dish.Categoria?.id ?? dish.Categorium?.id ?? '';
    form.id.value = dish.id;
    form.codigo.value = dish.codigo;
    form.nombre.value = dish.nombre;
    form.CategoriaId.value = String(categoryId);
    form.precio.value = Number(dish.precio);
    form.tiempo_preparacion.value = dish.tiempo_preparacion;
    form.disponible.value = String(dish.disponible);
    form.descripcion.value = dish.descripcion || '';
    form.factus_tax_code.value = dish.factus_tax_code || '01';
    form.factus_tax_rate.value = Number(dish.factus_tax_rate ?? 19);
    form.factus_is_excluded.checked = Boolean(dish.factus_is_excluded);
    form.factus_unit_measure_code.value = dish.factus_unit_measure_code || '94';
    form.factus_standard_code.value = dish.factus_standard_code || '999';
  } else {
    form.factus_tax_code.value = '01';
    form.factus_tax_rate.value = 19;
    form.factus_is_excluded.checked = false;
    form.factus_unit_measure_code.value = '94';
    form.factus_standard_code.value = '999';
  }
  openDialog('dishDialog');
}
async function saveDish(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  const id = values.id;
  const categoryId = Number(values.CategoriaId);
  if (!Number.isInteger(categoryId) || categoryId < 1) return toast('Selecciona una categoría válida.', 'warning');
  const body = {
    ...values,
    CategoriaId: categoryId,
    precio: Number(values.precio),
    tiempo_preparacion: Number(values.tiempo_preparacion),
    disponible: values.disponible === 'true',
    factus_tax_code: values.factus_tax_code || '01',
    factus_tax_rate: Number(values.factus_tax_rate || 0),
    factus_is_excluded: Boolean(event.target.factus_is_excluded.checked),
    factus_unit_measure_code: values.factus_unit_measure_code || '94',
    factus_standard_code: values.factus_standard_code || '999',
  };
  delete body.id;
  delete body.factus_is_excluded; // FormData omite checkboxes desmarcados; se reasigna abajo.
  body.factus_is_excluded = Boolean(event.target.factus_is_excluded.checked);
  try {
    await api(id ? `/platos/${id}` : '/platos', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
    closeDialog('dishDialog');
    toast(id ? 'Plato y categoría actualizados.' : 'Plato creado.');
    await renderPedidos();
  } catch (error) {
    toast(error.message, 'error');
  }
}
async function toggleDish(id, available) {
  try { await api(`/platos/${id}`, { method: 'PUT', body: JSON.stringify({ disponible: available }) }); toast(available ? 'Plato disponible.' : 'Plato marcado como agotado.'); await renderPedidos(); } catch (error) { toast(error.message, 'error'); }
}
async function createCategory() {
  const name = prompt('Nombre de la nueva categoría:');
  if (!name?.trim()) return;
  try { await api('/categorias', { method: 'POST', body: JSON.stringify({ nombre: name.trim() }) }); toast('Categoría creada.'); await renderPedidos(); } catch (error) { toast(error.message, 'error'); }
}
async function cancelOrder(id) {
  const reason = prompt('Motivo de cancelación del pedido:');
  if (!reason?.trim()) return;
  await changeOrderState(id, 'cancelado', reason.trim());
}

/* Despacho */
async function renderDespacho() {
  [state.pedidos, state.metodosPago] = await Promise.all([api('/pedidos'), api('/metodos-pago')]);
  const dispatchOrders = state.pedidos.filter((p) => ['enviado_despacho', 'confirmado_despacho', 'listo', 'en_entrega', 'entregado'].includes(p.estado));
  const active = dispatchOrders.filter((p) => ['enviado_despacho', 'confirmado_despacho', 'listo', 'en_entrega'].includes(p.estado));
  const ready = dispatchOrders.filter((p) => p.estado === 'listo');
  const unpaid = dispatchOrders.filter((p) => p.estado === 'entregado' && p.estado_pago !== 'pagado');
  main().innerHTML = `
    ${pageHeading('Despacho y caja', 'Recibe pedidos, verifica lo preparado, avisa al mesero y registra el pago.')}
    <section class="stats-grid dispatch-stats"><article class="stat-card"><span class="stat-icon">📥</span><div><strong>${active.length}</strong><small>Procesos activos</small></div></article><article class="stat-card"><span class="stat-icon">✓</span><div><strong>${ready.length}</strong><small>Por verificar</small></div></article><article class="stat-card"><span class="stat-icon">💳</span><div><strong>${unpaid.length}</strong><small>Cobros pendientes</small></div></article></section>
    <div class="inline-tip"><span>🔔</span><div><strong>Cómo avisar al mesero</strong><p>Cuando cocina marque el pedido como listo, revisa que estén todos los platos y pulsa “Verificar y avisar”. Solo entonces el mesero recibirá la notificación.</p></div></div>
    <section class="order-grid">${dispatchOrders.length ? dispatchOrders.map((p) => renderDispatchCard(p)).join('') : emptyState('📥', 'No hay pedidos en despacho', 'Los pedidos enviados por los meseros aparecerán aquí.')}</section>
    ${renderPaymentDialog()}
  `;
}

function renderDispatchCard(p) {
  const canManage = ['administrador', 'despacho'].includes(user.rol);
  let actions = '';
  let instruction = '';
  if (canManage && p.estado === 'enviado_despacho') {
    instruction = 'Revisa la información antes de enviarla a cocina.';
    actions = `<button class="btn btn-primary btn-sm" onclick="changeOrderState(${p.id},'confirmado_despacho')">Confirmar recepción</button><button class="btn btn-danger btn-sm" onclick="rejectOrder(${p.id})">Rechazar</button>`;
  }
  if (canManage && p.estado === 'confirmado_despacho') {
    instruction = 'Pedido confirmado. Envíalo a cocina.';
    actions = `<button class="btn btn-primary btn-sm" onclick="changeOrderState(${p.id},'enviado_cocina')">Enviar a cocina</button>`;
  }
  if (canManage && p.estado === 'listo') {
    instruction = 'Cuenta los platos, revisa presentación y observaciones.';
    actions = `<button class="btn btn-success" onclick="verifyAndNotifyWaiter(${p.id})">✓ Verificar y avisar al mesero</button>`;
  }
  if (p.estado === 'en_entrega') instruction = `El mesero ${escapeHtml(p.Mesero?.Usuario?.nombre || p.Mesero?.codigo || '')} fue notificado. Espera la confirmación de entrega.`;
  if (canManage && p.estado === 'entregado' && p.estado_pago !== 'pagado') {
    instruction = 'El pedido fue entregado al cliente. Registra el pago.';
    actions = `<button class="btn btn-primary" onclick="preparePayment(${p.id})">💳 Cobrar ${money(p.total)}</button>`;
  }
  return `<article class="panel order-card ${p.estado === 'listo' ? 'order-card-attention' : ''}"><div class="order-card-head"><div><h3>${escapeHtml(p.numero)}</h3><div class="order-meta"><span>Mesa ${p.Mesa?.numero || '-'}</span><span>Mesero: ${escapeHtml(p.Mesero?.Usuario?.nombre || p.Mesero?.codigo || '-')}</span><span class="timer">Espera ${elapsed(recordTimestamp(p))}</span></div></div>${badge(p.estado)}</div>${instruction ? `<div class="dispatch-instruction">${instruction}</div>` : ''}<div class="order-items">${(p.detalles || []).map((d) => `<div class="order-item"><span>${d.cantidad} × ${escapeHtml(d.Plato?.nombre || '')}</span>${badge(d.estado)}</div>`).join('')}</div><div class="order-total"><span>${badge(p.estado_pago)}</span><strong>${money(p.total)}</strong></div><div class="order-actions">${actions}</div></article>`;
}

async function verifyAndNotifyWaiter(id) {
  if (!confirm('¿Verificaste que el pedido está completo, correcto y listo para que el mesero lo recoja?')) return;
  await changeOrderState(id, 'en_entrega');
}

async function rejectOrder(id) {
  const reason = prompt('Motivo del rechazo:');
  if (!reason?.trim()) return;
  await changeOrderState(id, 'rechazado', reason.trim());
}

/* Cocina */
async function renderCocina() {
  state.pedidos = await api('/pedidos');
  const kitchenOrders = state.pedidos.filter((p) => ['enviado_cocina', 'en_preparacion', 'listo'].includes(p.estado));
  const pending = kitchenOrders.filter((p) => p.estado === 'enviado_cocina').length;
  const preparing = kitchenOrders.filter((p) => p.estado === 'en_preparacion').length;
  const ready = kitchenOrders.filter((p) => p.estado === 'listo').length;
  main().innerHTML = `
    ${pageHeading('Cocina', 'Prepara los platos. Al finalizar, despacho revisará el pedido antes de avisar al mesero.')}
    <section class="stats-grid" style="grid-template-columns:repeat(3,minmax(160px,1fr))"><article class="stat-card"><span class="stat-icon">▣</span><div><strong>${pending}</strong><small>Pendientes</small></div></article><article class="stat-card"><span class="stat-icon">♨</span><div><strong>${preparing}</strong><small>En preparación</small></div></article><article class="stat-card"><span class="stat-icon">✓</span><div><strong>${ready}</strong><small>Listos</small></div></article></section>
    <section class="order-grid">${kitchenOrders.length ? kitchenOrders.map(renderKitchenCard).join('') : emptyState('♨', 'La cocina está al día', 'Los pedidos enviados por despacho aparecerán aquí.')}</section>
  `;
}

function renderKitchenCard(p) {
  const canManage = ['administrador', 'cocina'].includes(user.rol);
  const allReady = (p.detalles || []).every((d) => ['preparado', 'cancelado', 'no_disponible'].includes(d.estado));
  let footer = '';
  if (canManage && p.estado === 'enviado_cocina') footer = `<button class="btn btn-warning" onclick="changeOrderState(${p.id},'en_preparacion')">Iniciar preparación</button>`;
  if (canManage && p.estado === 'en_preparacion') footer = `<button class="btn btn-success" ${allReady ? '' : 'disabled'} onclick="changeOrderState(${p.id},'listo')">Enviar listo a revisión de despacho</button>`;
  return `<article class="panel order-card"><div class="order-card-head"><div><h3>${escapeHtml(p.numero)}</h3><div class="order-meta"><span>Mesa ${p.Mesa?.numero || '-'}</span><span class="timer">${elapsed(recordTimestamp(p))} min</span></div></div>${badge(p.estado)}</div><p><small>${escapeHtml(p.notas_cocina || 'Sin notas generales')}</small></p><div>${(p.detalles || []).map((d) => renderKitchenItem(d, p.estado, canManage)).join('')}</div><div class="order-actions">${footer}</div></article>`;
}
function renderKitchenItem(detail, orderStatus, canManage) {
  let actions = '';
  if (canManage && orderStatus === 'en_preparacion' && !['preparado', 'cancelado'].includes(detail.estado)) actions = `<div class="table-actions"><button class="btn btn-success btn-sm" onclick="changeDetailState(${detail.id},'preparado')">Preparado</button><button class="btn btn-danger btn-sm" onclick="unavailableDetail(${detail.id})">No disponible</button></div>`;
  return `<div class="kitchen-item"><div><strong>${detail.cantidad} × ${escapeHtml(detail.Plato?.nombre || '')}</strong><br><small>${escapeHtml(detail.observaciones || 'Sin observaciones')}</small></div>${actions || badge(detail.estado)}</div>`;
}
async function changeDetailState(id, status, observation = '') {
  try { await api(`/detalles-pedido/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: status, observacion: observation }) }); toast('Estado del plato actualizado.'); await renderCocina(); } catch (error) { toast(error.message, 'error'); }
}
async function unavailableDetail(id) {
  const reason = prompt('Indica por qué el plato no está disponible:');
  if (!reason?.trim()) return;
  await changeDetailState(id, 'no_disponible', reason.trim());
}

async function changeOrderState(id, status, observation = '') {
  try { const result = await api(`/pedidos/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ estado: status, observacion: observation }) }); toast(status === 'en_entrega' ? 'Pedido verificado. El mesero recibió la notificación.' : 'Estado del pedido actualizado.'); await refreshCurrent(false); } catch (error) { toast(error.message, 'error'); }
}

/* Usuarios */
async function renderUsuarios() {
  state.usuarios = await api('/usuarios');
  main().innerHTML = `
    ${pageHeading('Usuarios', 'Administración de usuarios y roles.', '<button class="btn btn-primary" onclick="openDialog(\'userDialog\')">+ Nuevo usuario</button><button class="btn btn-danger" onclick="resetOperationalData()">Reiniciar datos demo</button>')}
    <section class="panel"><div class="panel-header"><h2>Usuarios del sistema</h2><span>${state.usuarios.length} usuarios</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th>Acciones</th></tr></thead><tbody>${state.usuarios.map((u) => `<tr><td><strong>${escapeHtml(u.nombre)}</strong></td><td>${escapeHtml(u.usuario)}</td><td>${escapeHtml(u.correo)}</td><td><span class="badge badge-${u.Role?.nombre === 'administrador' ? 'wine' : u.Role?.nombre === 'mesero' ? 'info' : u.Role?.nombre === 'cocina' ? 'warning' : 'success'}">${roleName(u.Role?.nombre)}</span></td><td>${badge(u.activo ? 'activo' : 'inactivo')}</td><td>${formatDateTime(u.ultimo_acceso)}</td><td><button class="btn ${u.activo ? 'btn-danger' : 'btn-success'} btn-sm" onclick="toggleUser(${u.id},${!u.activo})">${u.activo ? 'Desactivar' : 'Activar'}</button></td></tr>`).join('')}</tbody></table></div></section>
    ${renderUserDialog()}
  `;
}
function renderUserDialog() {
  return `<dialog id="userDialog"><div class="dialog-header"><div><h2>Nuevo usuario</h2><p>El usuario deberá cambiar su contraseña inicial.</p></div><button class="dialog-close" onclick="closeDialog('userDialog')">×</button></div><form class="dialog-body" onsubmit="saveUser(event)"><div class="form-grid"><div class="field span-2"><label>Nombre completo</label><input name="nombre" required></div><div class="field"><label>Usuario</label><input name="usuario" minlength="3" required></div><div class="field"><label>Correo</label><input name="correo" type="email" required></div><div class="field"><label>Rol</label><select name="rol" required><option value="mesero">Mesero</option><option value="cocina">Cocina</option><option value="despacho">Despacho</option><option value="administrador">Administrador</option></select></div><div class="field"><label>Contraseña inicial</label><input name="password" type="password" minlength="10" maxlength="72" required></div><div class="field span-2"><small class="field-help">La contraseña debe tener mayúscula, minúscula, número y símbolo.</small></div><div class="field span-2"><label>Código de mesero (opcional)</label><input name="codigo" placeholder="Solo se usa para el rol mesero"></div></div><div class="form-actions"><button type="button" class="btn btn-secondary" onclick="closeDialog('userDialog')">Cancelar</button><button class="btn btn-primary">Crear usuario</button></div></form></dialog>`;
}
async function saveUser(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  try { await api('/usuarios', { method: 'POST', body: JSON.stringify(values) }); closeDialog('userDialog'); toast('Usuario creado correctamente.'); await renderUsuarios(); } catch (error) { toast(error.message, 'error'); }
}
async function toggleUser(id, active) {
  if (!confirm(`¿Deseas ${active ? 'activar' : 'desactivar'} este usuario?`)) return;
  try { await api(`/usuarios/${id}/estado`, { method: 'PATCH', body: JSON.stringify({ activo: active }) }); toast(active ? 'Usuario activado.' : 'Usuario desactivado.'); await renderUsuarios(); } catch (error) { toast(error.message, 'error'); }
}
async function resetOperationalData() {
  const confirmation = prompt('Esta acción eliminará reservas, pedidos, pagos y clientes. Escribe REINICIAR para confirmar:');
  if (confirmation !== 'REINICIAR') return;
  try { await api('/sistema/reiniciar-datos', { method: 'POST', body: JSON.stringify({ confirmacion: 'REINICIAR' }) }); toast('Datos operativos reiniciados.', 'warning'); } catch (error) { toast(error.message, 'error'); }
}

/* Reportes */
async function renderReportes() {
  const params = new URLSearchParams(location.search);
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const desde = params.get('desde') || first;
  const hasta = params.get('hasta') || now.toISOString().slice(0, 10);
  state.report = await api(`/reportes/ventas?desde=${desde}&hasta=${hasta}`);
  const r = state.report;
  const methods = Object.entries(r.por_metodo || {});
  const maxMethod = Math.max(1, ...methods.map(([, value]) => value));
  const dishes = (r.platos || []).slice(0, 8);
  const maxDish = Math.max(1, ...dishes.map(([, value]) => value));

  main().innerHTML = `
    ${pageHeading('Reportes de ventas', 'Consulta totales por rango de fechas, método de pago y platos.', '<button class="btn btn-secondary" onclick="window.print()">Imprimir</button><button class="btn btn-primary" onclick="exportSalesCsv()">Exportar CSV</button>')}
    <form class="toolbar no-print" onsubmit="filterReports(event)"><div class="field" style="margin:0"><label>Desde</label><input name="desde" type="date" value="${desde}" required></div><div class="field" style="margin:0"><label>Hasta</label><input name="hasta" type="date" value="${hasta}" required></div><button class="btn btn-primary" style="align-self:end">Aplicar filtro</button></form>
    <section class="stats-grid report-stats"><article class="stat-card"><span class="stat-icon">$</span><div><strong>${money(r.ventas_sin_propina ?? r.total)}</strong><small>Ventas sin propina</small></div></article><article class="stat-card"><span class="stat-icon">♡</span><div><strong>${money(r.total_propinas || 0)}</strong><small>Propinas voluntarias</small></div></article><article class="stat-card"><span class="stat-icon">▥</span><div><strong>${r.cantidad}</strong><small>Pagos registrados</small></div></article><article class="stat-card"><span class="stat-icon">◉</span><div><strong>${money(r.ticket_promedio)}</strong><small>Ticket promedio</small></div></article></section>
    <div class="two-column"><section class="panel"><div class="panel-header"><h2>Ventas por método</h2></div><div class="panel-body chart-list">${methods.length ? methods.map(([name, value]) => `<div class="chart-row"><span>${escapeHtml(name)}</span><div class="chart-bar"><span style="width:${Math.max(3, value / maxMethod * 100)}%"></span></div><strong>${money(value)}</strong></div>`).join('') : emptyState('$', 'Sin ventas', 'No hay pagos en este rango.')}</div></section><section class="panel"><div class="panel-header"><h2>Platos más vendidos</h2></div><div class="panel-body chart-list">${dishes.length ? dishes.map(([name, value]) => `<div class="chart-row"><span>${escapeHtml(name)}</span><div class="chart-bar"><span style="width:${Math.max(3, value / maxDish * 100)}%"></span></div><strong>${value}</strong></div>`).join('') : emptyState('🍽', 'Sin datos', 'No hay platos vendidos en este rango.')}</div></section></div>
    <section class="panel" style="margin-top:20px"><div class="panel-header"><h2>Detalle de pagos</h2></div>${r.pagos.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Mesa</th><th>Método</th><th>Referencia</th><th>Propina</th><th>Total cobrado</th></tr></thead><tbody>${r.pagos.map((p) => `<tr><td>${paymentDateMarkup(p)}</td><td>${escapeHtml(p.Pedido?.numero || '-')}</td><td>Mesa ${p.Pedido?.Mesa?.numero || '-'}</td><td>${escapeHtml(p.MetodoPago?.nombre || '-')}</td><td>${paymentReferenceMarkup(p)}</td><td>${money(p.Pedido?.propina || 0)}</td><td><strong>${money(p.valor)}</strong></td></tr>`).join('')}</tbody></table></div>` : emptyState('▥', 'No hay pagos registrados', 'Cambia el rango de fechas o registra un pago.')}</section>
  `;
}
function filterReports(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  history.replaceState(null, '', `${location.pathname}#reportes`);
  api(`/reportes/ventas?desde=${values.desde}&hasta=${values.hasta}`).then((data) => { state.report = data; const url = new URL(location.href); url.searchParams.set('desde', values.desde); url.searchParams.set('hasta', values.hasta); history.replaceState(null, '', `${url.pathname}?${url.searchParams.toString()}#reportes`); renderReportes(); });
}
function exportSalesCsv() {
  const rows = [['Fecha', 'Pedido', 'Mesa', 'Método', 'Referencia', 'Propina', 'Total cobrado'], ...(state.report.pagos || []).map((p) => [formatDateTime(recordTimestamp(p)), p.Pedido?.numero || '', p.Pedido?.Mesa?.numero || '', p.MetodoPago?.nombre || '', paymentReference(p).text, p.Pedido?.propina || 0, p.valor])];
  const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = `ventas-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function printInvoice(id) {
  const p = state.pedidos.find((item) => item.id === id);
  if (!p) return;
  const invoice = p.Factura || {};
  const mock = invoice.proveedor === 'factus_mock';
  const electronic = invoice.proveedor === 'factus';
  const propina = Number(invoice.propina ?? p.propina ?? 0);
  const consumo = Math.round((Number(p.subtotal || 0) + Number(p.impuestos || 0) - Number(p.descuento || 0)) * 100) / 100;
  const payment = Array.isArray(p.Pagos) ? p.Pagos[0] : null;
  const popup = window.open('', '_blank', 'width=620,height=820');
  if (!popup) return toast('El navegador bloqueó la ventana de impresión.', 'warning');
  const notice = mock
    ? '<div class="beta">FACTURA SIMULADA — BETA<br><small>NO VÁLIDA ANTE LA DIAN</small></div>'
    : electronic
      ? '<div class="electronic">FACTURA ELECTRÓNICA</div>'
      : '<div class="internal">COMPROBANTE INTERNO</div>';
  const footer = mock
    ? 'Documento generado exclusivamente para pruebas de la versión beta. El CUFE, número y validación son simulados.'
    : electronic
      ? 'Documento electrónico validado por el proveedor configurado.'
      : 'Este comprobante interno no sustituye una factura electrónica validada por la DIAN.';
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Factura ${escapeHtml(invoice.numero || p.numero)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;max-width:440px;margin:24px auto;color:#172033;padding:0 12px}h1{text-align:center;margin:6px 0;color:#0f2f57}.center{text-align:center}.beta{background:#fff4cc;border:2px solid #b7791f;color:#7a4b00;padding:12px;text-align:center;font-weight:800;border-radius:8px;margin:12px 0}.electronic,.internal{background:#eaf2fb;border:1px solid #8eb1d8;color:#0f3f70;padding:10px;text-align:center;font-weight:800;border-radius:8px;margin:12px 0}.meta{font-size:13px;line-height:1.55;border-bottom:1px solid #ccd5e0;padding-bottom:10px}.line{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed #bbc5d1;padding:8px 0}.line span:first-child{min-width:0}.summary{margin-top:12px}.grand{font-size:21px;font-weight:800;color:#0f2f57;border-top:2px solid #0f2f57}.tip{font-weight:700}.muted{color:#5f6c7b;font-size:11px;line-height:1.5;overflow-wrap:anywhere}.cufe{font-size:9px;overflow-wrap:anywhere;background:#f5f7fa;padding:8px;border-radius:6px}.print{width:100%;padding:11px;margin-top:16px;background:#0f3f70;color:white;border:0;border-radius:7px;font-weight:700}@media print{body{margin:0 auto}.print{display:none}}
  </style></head><body><h1>ReservaRest</h1><p class="center">Sistema de reservas y restaurante</p>${notice}<div class="meta"><strong>Factura:</strong> ${escapeHtml(invoice.numero || 'Pendiente')}<br><strong>Pedido:</strong> ${escapeHtml(p.numero)}<br><strong>Mesa:</strong> ${p.Mesa?.numero || '-'}<br><strong>Fecha:</strong> ${formatDateTime(recordTimestamp(invoice) || recordTimestamp(p))}<br><strong>Cliente:</strong> ${escapeHtml(p.Cliente?.nombre || 'Consumidor final')}${payment?.MetodoPago?.nombre ? `<br><strong>Medio de pago:</strong> ${escapeHtml(payment.MetodoPago.nombre)}` : ''}</div><h3>Detalle</h3>${(p.detalles || []).map((d) => `<div class="line"><span>${d.cantidad} × ${escapeHtml(d.Plato?.nombre || '')}</span><span>${money(Number(d.precio_unitario) * d.cantidad)}</span></div>`).join('')}<div class="summary"><div class="line"><span>Subtotal antes de IVA</span><span>${money(p.subtotal)}</span></div><div class="line"><span>IVA (19%)</span><span>${money(p.impuestos)}</span></div>${Number(p.descuento || 0) > 0 ? `<div class="line"><span>Descuento</span><span>− ${money(p.descuento)}</span></div>` : ''}<div class="line"><span>Total consumo</span><span>${money(consumo)}</span></div><div class="line tip"><span>Propina voluntaria (${Number(p.propina_porcentaje || 0)}%)</span><span>${money(propina)}</span></div><div class="line grand"><span>Total pagado</span><span>${money(invoice.total ?? p.total)}</span></div></div>${invoice.cufe ? `<p><strong>${mock ? 'CUFE simulado' : 'CUFE'}:</strong></p><p class="cufe">${escapeHtml(invoice.cufe)}</p>` : ''}<p class="muted">${escapeHtml(footer)}</p><button class="print" onclick="print()">Imprimir</button></body></html>`);
  popup.document.close();
}

init();
