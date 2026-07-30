function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100;
}

function clampRate(value, maxValue) {
  return Math.min(Math.max(number(value), 0), Math.max(number(maxValue), 0));
}

function calculateBillTotals(pedido, includeTip, options = {}) {
  const consumption = roundMoney(number(pedido.subtotal) + number(pedido.impuestos) - number(pedido.descuento));
  if (consumption < 0) throw Object.assign(new Error('El total del consumo no puede ser negativo'), { status: 422 });
  const suggestedRate = options.tipRate ?? process.env.TIP_RATE ?? 0.10;
  const maxRate = options.maxTipRate ?? process.env.TIP_MAX_RATE ?? 0.10;
  const appliedRate = includeTip ? clampRate(suggestedRate, maxRate) : 0;
  const tip = roundMoney(consumption * appliedRate);
  return {
    consumption,
    tip,
    tipRate: roundMoney(appliedRate * 100),
    total: roundMoney(consumption + tip),
  };
}

module.exports = { calculateBillTotals, roundMoney };
