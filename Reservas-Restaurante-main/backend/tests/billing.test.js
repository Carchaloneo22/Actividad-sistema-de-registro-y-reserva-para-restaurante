const { calculateBillTotals } = require('../src/services/billingService');

describe('IVA y propina V11', () => {
  test('suma la propina voluntaria del 10% al total del consumo', () => {
    const result = calculateBillTotals({ subtotal: 100000, impuestos: 19000, descuento: 0 }, true, { tipRate: 0.10, maxTipRate: 0.10 });
    expect(result).toEqual({ consumption: 119000, tip: 11900, tipRate: 10, total: 130900 });
  });

  test('no incluye propina cuando el cliente no la acepta', () => {
    const result = calculateBillTotals({ subtotal: 100000, impuestos: 19000, descuento: 0 }, false, { tipRate: 0.10, maxTipRate: 0.10 });
    expect(result).toEqual({ consumption: 119000, tip: 0, tipRate: 0, total: 119000 });
  });

  test('limita la propina configurada al máximo permitido', () => {
    const result = calculateBillTotals({ subtotal: 10000, impuestos: 1900, descuento: 0 }, true, { tipRate: 0.20, maxTipRate: 0.10 });
    expect(result.tipRate).toBe(10);
    expect(result.tip).toBe(1190);
  });
});
