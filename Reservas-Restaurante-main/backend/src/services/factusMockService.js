const crypto = require('crypto');

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function compactDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('');
}

function calculatePayloadTotals(payload = {}) {
  let subtotal = 0;
  let discounts = 0;
  let taxes = 0;
  for (const item of payload.items || []) {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.price || 0);
    const lineBase = quantity * unitPrice;
    const discount = Number(item.discount_amount || 0) || (lineBase * Number(item.discount_rate || 0) / 100);
    const taxable = Math.max(lineBase - discount, 0);
    const taxRate = Number(item.taxes?.[0]?.rate || 0);
    subtotal += lineBase;
    discounts += discount;
    taxes += taxable * taxRate / 100;
  }
  const invoiceTotal = subtotal - discounts + taxes;
  return {
    subtotal: money(subtotal),
    discounts: money(discounts),
    taxes: money(taxes),
    invoiceTotal: money(invoiceTotal),
  };
}

function createMockInvoice(payload = {}) {
  const createdAt = new Date();
  const reference = String(payload.reference_code || `RR-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    reference,
    items: payload.items,
    customer: payload.customer?.identification || payload.customer?.names || 'CONSUMIDOR-FINAL',
  })).digest('hex').toUpperCase();
  const numberSuffix = digest.slice(0, 8);
  const totals = calculatePayloadTotals(payload);

  return {
    status: 'MOCK_CREATED',
    message: 'Factura simulada creada correctamente',
    data: {
      bill: {
        number: `BETA-${compactDate(createdAt)}-${numberSuffix}`,
        reference_code: reference,
        cufe: `CUFE-SIMULADO-${digest}`,
        is_validated: false,
        is_mock: true,
        mock_notice: 'FACTURA SIMULADA — BETA — NO VÁLIDA ANTE LA DIAN',
        validated_at: createdAt.toISOString(),
        public_url: null,
        qr: null,
        totals,
      },
    },
  };
}

module.exports = { createMockInvoice, calculatePayloadTotals };
