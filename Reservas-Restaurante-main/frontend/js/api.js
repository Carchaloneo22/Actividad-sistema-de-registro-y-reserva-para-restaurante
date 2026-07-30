const API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:3000/api'
  : '/api';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) || null;
}

async function refreshCsrfToken() {
  let response;
  try {
    response = await fetch(`${API_BASE}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (_) {
    throw new Error('No fue posible preparar la conexión segura con el servidor.');
  }
  if (!response.ok) throw new Error('No fue posible preparar la protección de la sesión.');
  const token = readCookie('csrf_token');
  if (!token) throw new Error('El navegador bloqueó la protección de la sesión.');
  return token;
}

async function api(path, options = {}, retriedCsrf = false) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    Accept: 'application/json',
    ...(options.body instanceof FormData || options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {}),
  };

  if (!SAFE_HTTP_METHODS.has(method)) {
    headers['X-CSRF-Token'] = readCookie('csrf_token') || await refreshCsrfToken();
  }

  const config = {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    method,
    headers,
  };

  let response;
  try {
    response = await fetch(API_BASE + path, config);
  } catch (_) {
    throw new Error('No fue posible conectar con el servidor. Revisa que el backend siga encendido.');
  }

  const payload = await response.json().catch(() => ({ success: false, message: 'El servidor devolvió una respuesta inválida.' }));

  if (response.status === 403 && !retriedCsrf && String(payload.message || '').includes('CSRF')) {
    await refreshCsrfToken();
    return api(path, options, true);
  }

  if (response.status === 401 && !location.pathname.includes('login')) {
    sessionStorage.removeItem('user');
    location.href = '/login.html?expired=1';
    throw new Error('La sesión expiró.');
  }

  if (!response.ok) {
    const validation = Array.isArray(payload.errors) && payload.errors.length
      ? ` ${payload.errors.map((item) => item.msg || item.message || item).join(', ')}`
      : '';
    throw new Error((payload.message || 'No fue posible completar la operación.') + validation);
  }

  return payload.data;
}

function toast(message, type = 'success') {
  const region = document.querySelector('#toastRegion') || document.body;
  const element = document.createElement('div');
  element.className = `toast toast-${type}`;
  element.innerHTML = `<span aria-hidden="true">${type === 'error' ? '!' : type === 'warning' ? '⚠' : '✓'}</span><p>${escapeHtml(message)}</p>`;
  region.appendChild(element);
  setTimeout(() => element.classList.add('toast-visible'), 10);
  setTimeout(() => {
    element.classList.remove('toast-visible');
    setTimeout(() => element.remove(), 220);
  }, 3600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
