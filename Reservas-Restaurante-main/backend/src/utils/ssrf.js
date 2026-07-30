const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

function splitCsv(value) {
  return String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

const blockedNetworks = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([network, prefix]) => blockedNetworks.addSubnet(network, prefix, 'ipv4'));

[
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8],
].forEach(([network, prefix]) => blockedNetworks.addSubnet(network, prefix, 'ipv6'));

function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (!family) return true;
  return blockedNetworks.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

function normalizeAllowlist(allowlist) {
  return Array.isArray(allowlist)
    ? allowlist.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : splitCsv(allowlist);
}

function hostMatchesAllowlist(hostname, allowlist) {
  return normalizeAllowlist(allowlist).some((entry) => {
    if (entry.startsWith('*.')) {
      const bare = entry.slice(2);
      return hostname.endsWith(`.${bare}`) && hostname !== bare;
    }
    return hostname === entry;
  });
}

function parseAndValidateUrl(rawUrl, allowedHosts = splitCsv(process.env.SSRF_ALLOWED_HOSTS)) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    throw Object.assign(new Error('URL externa inválida'), { code: 'SSRF_URL_INVALID' });
  }

  if (url.protocol !== 'https:') throw Object.assign(new Error('Solo se permiten conexiones HTTPS'), { code: 'SSRF_PROTOCOL_BLOCKED' });
  if (url.username || url.password) throw Object.assign(new Error('No se permiten credenciales dentro de la URL'), { code: 'SSRF_CREDENTIALS_BLOCKED' });
  if (url.port && url.port !== '443') throw Object.assign(new Error('Puerto externo no permitido'), { code: 'SSRF_PORT_BLOCKED' });

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const blockedNames = ['localhost', 'localhost.localdomain', 'metadata.google.internal'];
  const blockedSuffixes = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.test', '.invalid'];
  if (blockedNames.includes(hostname) || blockedSuffixes.some((suffix) => hostname.endsWith(suffix))) {
    throw Object.assign(new Error('Host interno bloqueado'), { code: 'SSRF_HOST_BLOCKED' });
  }

  const normalizedAllowlist = normalizeAllowlist(allowedHosts);
  if (!normalizedAllowlist.length || !hostMatchesAllowlist(hostname, normalizedAllowlist)) {
    throw Object.assign(new Error('Host externo no autorizado'), { code: 'SSRF_HOST_NOT_ALLOWLISTED' });
  }
  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    throw Object.assign(new Error('Dirección IP privada o reservada bloqueada'), { code: 'SSRF_IP_BLOCKED' });
  }
  return { url, hostname };
}

async function resolvePublicAddresses(hostname) {
  const addresses = await dns.lookup(hostname, { all: true, order: 'verbatim' });
  if (!addresses.length) throw Object.assign(new Error('El host no tiene direcciones válidas'), { code: 'SSRF_DNS_EMPTY' });
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    throw Object.assign(new Error('El host resuelve a una red privada o reservada'), { code: 'SSRF_DNS_BLOCKED' });
  }
  return addresses;
}

function normalizeOutboundHeaders(headers = {}) {
  const allowed = new Set(['accept', 'content-type', 'authorization', 'user-agent']);
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = String(key).toLowerCase();
    if (!allowed.has(normalized)) continue;
    if (/[\r\n]/.test(String(value))) throw Object.assign(new Error('Encabezado externo inválido'), { code: 'OUTBOUND_HEADER_INVALID' });
    result[key] = String(value);
  }
  return result;
}

async function safeHttpsRequest(rawUrl, options = {}) {
  const allowedHosts = options.allowedHosts || splitCsv(process.env.SSRF_ALLOWED_HOSTS);
  const { url, hostname } = parseAndValidateUrl(rawUrl, allowedHosts);
  const addresses = await resolvePublicAddresses(hostname);
  const pinned = addresses[0];
  const method = String(options.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw Object.assign(new Error('Método HTTP externo no permitido'), { code: 'OUTBOUND_METHOD_BLOCKED' });
  }

  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs || process.env.OUTBOUND_TIMEOUT_MS || 8000), 500), 30000);
  const maxBytes = Math.min(Math.max(Number(options.maxBytes || process.env.OUTBOUND_MAX_BYTES || 2_097_152), 1024), 10_485_760);
  const body = options.body === undefined || options.body === null
    ? null
    : Buffer.isBuffer(options.body) ? options.body : Buffer.from(String(options.body), 'utf8');
  const maxRequestBytes = Math.min(Math.max(Number(options.maxRequestBytes || 1_048_576), 1024), 2_097_152);
  if (body && body.length > maxRequestBytes) {
    throw Object.assign(new Error('Solicitud externa demasiado grande'), { code: 'OUTBOUND_REQUEST_SIZE_LIMIT' });
  }

  const headers = normalizeOutboundHeaders({
    Accept: options.accept || 'application/json',
    'User-Agent': 'ReservaRest/1.2',
    ...(options.headers || {}),
  });
  if (body) headers['Content-Length'] = String(body.length);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    const request = https.request({
      protocol: 'https:', hostname, port: 443, method,
      path: `${url.pathname}${url.search}`,
      servername: hostname,
      rejectUnauthorized: true,
      headers,
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        return finish(reject, Object.assign(new Error('Las redirecciones externas están deshabilitadas'), { code: 'SSRF_REDIRECT_BLOCKED', statusCode: response.statusCode }));
      }

      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(Object.assign(new Error('Respuesta externa demasiado grande'), { code: 'OUTBOUND_SIZE_LIMIT' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(resolve, {
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.on('error', (error) => finish(reject, error));
    });

    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('Tiempo de espera externo agotado'), { code: 'OUTBOUND_TIMEOUT' })));
    request.on('error', (error) => finish(reject, error));
    if (body) request.write(body);
    request.end();
  });
}

async function safeHttpsGet(rawUrl, options = {}) {
  return safeHttpsRequest(rawUrl, { ...options, method: 'GET' });
}

function assertLocalAssetPath(value) {
  if (value === null || value === undefined || value === '') return null;
  const candidate = String(value).trim().replaceAll('\\', '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith('//')) {
    throw Object.assign(new Error('La imagen debe ser un archivo local, no una URL externa'), { status: 422 });
  }
  if (candidate.includes('..') || candidate.includes('\0')) {
    throw Object.assign(new Error('Ruta de imagen inválida'), { status: 422 });
  }
  if (!/^(assets\/|uploads\/)[A-Za-z0-9/_ .-]+$/.test(candidate)) {
    throw Object.assign(new Error('Ruta de imagen no permitida'), { status: 422 });
  }
  return candidate;
}

module.exports = {
  isBlockedIp,
  parseAndValidateUrl,
  resolvePublicAddresses,
  safeHttpsRequest,
  safeHttpsGet,
  assertLocalAssetPath,
};
