const { safeHttpsRequest } = require('../utils/ssrf');
const { createMockInvoice } = require('./factusMockService');

const FACTUS_HOSTS = {
  sandbox: 'api-sandbox.factus.com.co',
  production: 'api.factus.com.co',
};
const ALLOWED_PAYMENT_CODES = new Set(['1', '10', '20', '42', '47', '48', '49', '71', '72', 'ZZZ']);
let tokenCache = { accessToken: null, expiresAt: 0 };

function mockMode() {
  return ['1', 'true', 'yes', 'si', 'sí'].includes(String(process.env.FACTUS_MOCK_MODE || '').toLowerCase())
    || String(process.env.FACTUS_ENV || '').toLowerCase() === 'mock';
}

function envName() {
  if (mockMode()) return 'mock';
  return String(process.env.FACTUS_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
}

function host() {
  return mockMode() ? null : FACTUS_HOSTS[envName()];
}

function baseUrl() {
  if (mockMode()) throw Object.assign(new Error('El modo simulado no realiza conexiones externas'), { status: 409, code: 'FACTUS_MOCK_NO_NETWORK' });
  return `https://${host()}`;
}

function enabled() {
  return ['1', 'true', 'yes', 'si', 'sí'].includes(String(process.env.FACTUS_ENABLED || '').toLowerCase());
}

function missingCredentials() {
  return ['FACTUS_CLIENT_ID', 'FACTUS_CLIENT_SECRET', 'FACTUS_USERNAME', 'FACTUS_PASSWORD']
    .filter((name) => !String(process.env[name] || '').trim());
}

function status() {
  const missing = mockMode() ? [] : missingCredentials();
  return {
    enabled: enabled(),
    configured: enabled() && (mockMode() || missing.length === 0),
    mock_mode: mockMode(),
    environment: envName(),
    host: host() || 'local-simulator',
    numbering_range_id: Number(process.env.FACTUS_NUMBERING_RANGE_ID) || null,
    missing,
  };
}

function assertConfigured() {
  const current = status();
  if (!current.enabled) throw Object.assign(new Error('La facturación electrónica Factus está desactivada'), { status: 503, code: 'FACTUS_DISABLED' });
  if (!current.configured) throw Object.assign(new Error(`Faltan credenciales de Factus: ${current.missing.join(', ')}`), { status: 503, code: 'FACTUS_NOT_CONFIGURED' });
}

function safeJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (_) {
    return null;
  }
}

function factusError(response, fallback = 'Factus rechazó la solicitud') {
  const payload = safeJson(response.body);
  const validation = payload?.errors || payload?.data?.errors || null;
  const message = payload?.message || payload?.error_description || payload?.error || fallback;
  const providerStatus = Number(response.status || 0);
  const status = providerStatus === 429 ? 503 : providerStatus >= 400 && providerStatus < 500 ? 422 : 502;
  return Object.assign(new Error(message), {
    status,
    code: providerStatus === 429 ? 'FACTUS_RATE_LIMIT' : 'FACTUS_API_ERROR',
    providerStatus,
    errors: validation ? [{ provider: 'Factus', details: validation }] : [],
  });
}

async function obtainAccessToken(force = false) {
  assertConfigured();
  if (!force && tokenCache.accessToken && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.accessToken;

  const form = new URLSearchParams({
    grant_type: 'password',
    client_id: String(process.env.FACTUS_CLIENT_ID),
    client_secret: String(process.env.FACTUS_CLIENT_SECRET),
    username: String(process.env.FACTUS_USERNAME),
    password: String(process.env.FACTUS_PASSWORD),
  }).toString();

  const response = await safeHttpsRequest(`${baseUrl()}/oauth/token`, {
    method: 'POST',
    allowedHosts: [host()],
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    timeoutMs: Number(process.env.FACTUS_TIMEOUT_MS || 12000),
    maxBytes: 512_000,
  });
  if (response.status < 200 || response.status >= 300) throw factusError(response, 'No fue posible autenticar con Factus');

  const payload = safeJson(response.body);
  if (!payload?.access_token) throw Object.assign(new Error('Factus no devolvió un token de acceso válido'), { status: 502, code: 'FACTUS_TOKEN_INVALID' });
  const expiresIn = Math.max(Number(payload.expires_in) || 600, 60);
  tokenCache = { accessToken: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
  return tokenCache.accessToken;
}

async function request(path, options = {}, retried = false) {
  const token = await obtainAccessToken(retried);
  const response = await safeHttpsRequest(`${baseUrl()}${path}`, {
    method: options.method || 'GET',
    allowedHosts: [host()],
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    timeoutMs: Number(process.env.FACTUS_TIMEOUT_MS || 15000),
    maxBytes: Number(options.maxBytes || 5_242_880),
  });

  if (response.status === 401 && !retried) {
    tokenCache = { accessToken: null, expiresAt: 0 };
    return request(path, options, true);
  }
  if (response.status < 200 || response.status >= 300) throw factusError(response);
  const payload = safeJson(response.body);
  if (!payload) throw Object.assign(new Error('Factus devolvió una respuesta JSON inválida'), { status: 502, code: 'FACTUS_RESPONSE_INVALID' });
  return payload;
}

function money(value) {
  return (Math.round(Number(value || 0) * 100) / 100).toFixed(2);
}

function normalizeReference(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
}

function paymentMethodCode(methodName, requestedCode) {
  const explicit = String(requestedCode || '').trim().toUpperCase();
  if (ALLOWED_PAYMENT_CODES.has(explicit)) return explicit;
  const normalized = String(methodName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (normalized.includes('efectivo')) return '10';
  if (normalized.includes('transferencia')) return '47';
  if (normalized.includes('tarjeta')) return '48';
  if (normalized.includes('consignacion')) return '42';
  if (normalized.includes('cheque')) return '20';
  if (normalized.includes('bono')) return '71';
  if (normalized.includes('vale')) return '72';
  return 'ZZZ';
}

function buildCustomer(customerInput = {}, fallbackCustomer = null) {
  if (customerInput.consumidor_final !== false) {
    return {
      identification_document_code: '13',
      identification: String(process.env.FACTUS_CONSUMER_FINAL_ID || '22222222222'),
      names: 'Consumidor Final',
    };
  }

  const legal = String(customerInput.legal_organization_code || '2');
  const identification = String(customerInput.identification || fallbackCustomer?.documento || '').replace(/\D/g, '');
  const names = String(customerInput.names || fallbackCustomer?.nombre || '').trim();
  const company = String(customerInput.company || '').trim();
  if (!identification) throw Object.assign(new Error('Para factura electrónica debes registrar la identificación del cliente'), { status: 422 });
  if (legal === '1' && !company) throw Object.assign(new Error('Registra la razón social del cliente jurídico'), { status: 422 });
  if (legal === '2' && !names) throw Object.assign(new Error('Registra el nombre del cliente'), { status: 422 });

  const customer = {
    identification_document_code: String(customerInput.identification_document_code || '13'),
    identification,
    legal_organization_code: legal,
    tribute_code: String(customerInput.tribute_code || 'ZZ'),
    ...(legal === '1' ? { company } : { names }),
  };
  const optional = {
    dv: customerInput.dv,
    trade_name: customerInput.trade_name,
    address: customerInput.address,
    email: customerInput.email || fallbackCustomer?.correo,
    phone: customerInput.phone || fallbackCustomer?.telefono,
    country_code: customerInput.country_code || 'CO',
    municipality_code: customerInput.municipality_code,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') customer[key] = String(value).trim();
  }
  return customer;
}

function buildItems(pedido) {
  const details = pedido.detalles || [];
  if (!details.length) throw Object.assign(new Error('El pedido no tiene productos para facturar'), { status: 422 });
  const orderDiscount = Number(pedido.descuento || 0);
  const orderSubtotal = Number(pedido.subtotal || 0);
  let distributedDiscount = 0;

  return details.map((detail, index) => {
    const quantity = Number(detail.cantidad || 0);
    const unitPrice = Number(detail.precio_unitario || 0);
    const lineBase = unitPrice * quantity;
    const isLast = index === details.length - 1;
    const discountAmount = orderDiscount > 0 && orderSubtotal > 0
      ? (isLast ? orderDiscount - distributedDiscount : Math.round((orderDiscount * lineBase / orderSubtotal) * 100) / 100)
      : 0;
    distributedDiscount += discountAmount;

    const taxCode = String(detail.impuesto_codigo || process.env.FACTUS_DEFAULT_TAX_CODE || '01');
    const taxRate = Number(detail.impuesto_tasa ?? process.env.FACTUS_DEFAULT_TAX_RATE ?? 19);
    const excluded = Boolean(detail.impuesto_excluido);
    return {
      code_reference: String(detail.Plato?.codigo || `PLATO-${detail.PlatoId}`),
      name: String(detail.Plato?.nombre || 'Producto'),
      quantity: money(quantity),
      ...(discountAmount > 0 ? { discount_amount: money(discountAmount) } : { discount_rate: '0.00' }),
      price: money(unitPrice),
      unit_measure_code: String(detail.unidad_medida_codigo || detail.Plato?.factus_unit_measure_code || '94'),
      standard_code: String(detail.codigo_estandar || detail.Plato?.factus_standard_code || '999'),
      note: String(detail.observaciones || '').slice(0, 5000) || undefined,
      taxes: [{ code: taxCode, rate: money(excluded ? 0 : taxRate), ...(excluded ? { is_excluded: true } : {}) }],
    };
  }).map((item) => Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)));
}

function validateExpectedTotal(pedido, items) {
  let computed = 0;
  for (const item of items) {
    const base = Number(item.price) * Number(item.quantity) - Number(item.discount_amount || 0);
    const rate = Number(item.taxes?.[0]?.rate || 0);
    computed += base + (base * rate / 100);
  }
  const expected = Number(pedido.subtotal || 0) + Number(pedido.impuestos || 0) - Number(pedido.descuento || 0);
  if (Math.abs(computed - expected) > 0.10) {
    throw Object.assign(new Error(`Los impuestos configurados para Factus no coinciden con el total del pedido. Calculado: ${money(computed)}, pedido: ${money(expected)}`), { status: 422, code: 'FACTUS_TOTAL_MISMATCH' });
  }
}

function buildInvoicePayload({ pedido, pago, metodo, customerInput, sendEmail, referenceCode }) {
  const items = buildItems(pedido);
  validateExpectedTotal(pedido, items);
  const customer = buildCustomer(customerInput, pedido.Cliente);
  if (sendEmail && !customer.email) throw Object.assign(new Error('Registra el correo del cliente para enviar la factura electrónica'), { status: 422 });

  const numberingRangeId = Number(process.env.FACTUS_NUMBERING_RANGE_ID || 0);
  const payload = {
    reference_code: normalizeReference(referenceCode || `RR-${pedido.numero}-${pedido.id}`),
    created_time: new Date().toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    document: '01',
    operation_type: '10',
    send_email: Boolean(sendEmail),
    observation: `Pedido ${pedido.numero} - Mesa ${pedido.Mesa?.numero || pedido.MesaId}`.slice(0, 250),
    order_reference: { reference_code: String(pedido.numero).slice(0, 80) },
    payment_details: [{
      payment_form: '1',
      payment_method_code: paymentMethodCode(metodo?.nombre, pago?.factus_payment_method_code),
      amount: money(Number(pedido.subtotal || 0) + Number(pedido.impuestos || 0) - Number(pedido.descuento || 0)),
      ...(pago?.referencia ? { reference_code: String(pago.referencia).slice(0, 100) } : {}),
    }],
    customer,
    items,
  };
  if (numberingRangeId > 0) payload.numbering_range_id = numberingRangeId;
  return payload;
}

function invoiceData(response) {
  const data = response?.data && typeof response.data === 'object' ? response.data : response;
  const source = data?.bill || data?.invoice || response?.bill || response?.invoice || data || {};
  const bill = source && typeof source === 'object' ? source : {};
  const links = bill.links || data?.links || response?.links || {};
  const validatedValue = bill.is_validated ?? bill.validated ?? data?.is_validated;
  return {
    ...bill,
    number: bill.number || bill.bill_number || bill.document_number || null,
    cufe: bill.cufe || bill.cufe_code || bill.uuid || null,
    is_validated: validatedValue === true || validatedValue === 1 || String(validatedValue).toLowerCase() === 'true',
    links: links && typeof links === 'object' ? links : {},
  };
}


function storageSnapshot(response) {
  const invoice = invoiceData(response);
  return {
    status: response?.status ?? response?.code ?? null,
    message: response?.message ? String(response.message).slice(0, 500) : null,
    bill: {
      number: invoice.number || null,
      reference_code: invoice.reference_code || null,
      cufe: invoice.cufe || null,
      is_validated: Boolean(invoice.is_validated),
      is_mock: Boolean(invoice.is_mock),
      mock_notice: invoice.mock_notice || null,
      totals: invoice.totals || null,
      validated_at: invoice.validated_at || invoice.validatedAt || null,
      public_url: invoice.public_url || invoice.links?.public_url || null,
      qr: invoice.qr || invoice.links?.qr || null,
    },
  };
}

async function createAndValidateInvoice(payload) {
  assertConfigured();
  if (mockMode()) {
    const response = createMockInvoice(payload);
    return { raw: response, data: invoiceData(response) };
  }
  const response = await request('/v2/bills/validate', { method: 'POST', body: payload });
  return { raw: response, data: invoiceData(response) };
}

async function listNumberingRanges() {
  assertConfigured();
  if (mockMode()) return { data: [{ id: 1, prefix: 'BETA', from: 1, to: 999999, current: 1, mock: true }] };
  return request('/v2/numbering-ranges/dian');
}

async function download(number, type) {
  const safeNumber = encodeURIComponent(String(number));
  const path = type === 'xml'
    ? `/v2/bills/${safeNumber}/download-xml/`
    : `/v2/bills/${safeNumber}/download-pdf`;
  const response = await request(path, { maxBytes: 10_485_760 });
  const data = response?.data || response;
  const base64 = type === 'xml' ? data.xml_base_64_encoded : data.pdf_base_64_encoded;
  const filename = data.file_name || data.filename || `${number}.${type}`;
  if (!base64) throw Object.assign(new Error(`Factus no devolvió el archivo ${type.toUpperCase()}`), { status: 502 });
  return { buffer: Buffer.from(base64, 'base64'), filename };
}

async function sendInvoiceEmail(number, email) {
  return request(`/v2/bills/${encodeURIComponent(String(number))}/send-email`, { method: 'POST', body: { email } });
}

module.exports = {
  status,
  mockMode,
  paymentMethodCode,
  buildInvoicePayload,
  createAndValidateInvoice,
  listNumberingRanges,
  download,
  sendInvoiceEmail,
  storageSnapshot,
};
