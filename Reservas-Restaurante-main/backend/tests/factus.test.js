const factus = require('../src/services/factusService');

describe('Integración Factus', () => {
  test('mapea los medios de pago sin confiar en el navegador', () => {
    expect(factus.paymentMethodCode('Efectivo')).toBe('10');
    expect(factus.paymentMethodCode('Transferencia')).toBe('47');
    expect(factus.paymentMethodCode('Tarjeta', '49')).toBe('49');
    expect(factus.paymentMethodCode('Otro', 'codigo-invalido')).toBe('ZZZ');
  });

  test('construye una factura idempotente para consumidor final', () => {
    const pedido = {
      id: 7,
      numero: 'PED-7',
      subtotal: 10000,
      impuestos: 1900,
      descuento: 0,
      total: 11900,
      MesaId: 2,
      Mesa: { numero: 2 },
      Cliente: null,
      detalles: [{
        PlatoId: 3,
        cantidad: 1,
        precio_unitario: 10000,
        impuesto_codigo: '01',
        impuesto_tasa: 19,
        impuesto_excluido: false,
        unidad_medida_codigo: '94',
        codigo_estandar: '999',
        observaciones: null,
        Plato: { codigo: 'PL-003', nombre: 'Plato de prueba' },
      }],
    };

    const payload = factus.buildInvoicePayload({
      pedido,
      pago: { factus_payment_method_code: '10' },
      metodo: { nombre: 'Efectivo' },
      customerInput: { consumidor_final: true },
      sendEmail: false,
      referenceCode: 'RR-PED-7-7',
    });

    expect(payload.reference_code).toBe('RR-PED-7-7');
    expect(payload.customer.names).toBe('Consumidor Final');
    expect(payload.payment_details[0].payment_method_code).toBe('10');
    expect(payload.items[0].taxes[0]).toEqual(expect.objectContaining({ code: '01', rate: '19.00' }));
  });

  test('rechaza totales manipulados o impuestos inconsistentes', () => {
    const pedido = {
      id: 8,
      numero: 'PED-8',
      subtotal: 10000,
      impuestos: 0,
      descuento: 0,
      total: 10000,
      detalles: [{
        PlatoId: 1,
        cantidad: 1,
        precio_unitario: 10000,
        impuesto_codigo: '01',
        impuesto_tasa: 19,
        Plato: { codigo: 'P1', nombre: 'Prueba' },
      }],
    };

    expect(() => factus.buildInvoicePayload({
      pedido,
      pago: {},
      metodo: { nombre: 'Efectivo' },
      customerInput: { consumidor_final: true },
      sendEmail: false,
      referenceCode: 'RR-8',
    })).toThrow(/no coinciden con el total/i);
  });
  test('minimiza la respuesta almacenada y no conserva datos completos del cliente', () => {
    const snapshot = factus.storageSnapshot({
      status: 'Created',
      message: 'Factura validada',
      data: {
        bill: { number: 'SETT1', cufe: 'CUFE-DEMO', is_validated: true, reference_code: 'RR-1' },
        customer: { identification: '1099999999', names: 'Dato que no debe persistir en el snapshot' },
        items: [{ name: 'Producto' }],
      },
    });
    expect(snapshot.bill.number).toBe('SETT1');
    expect(snapshot.bill.cufe).toBe('CUFE-DEMO');
    expect(snapshot.customer).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('1099999999');
  });

});

describe('Factus simulado V11', () => {
  const original = { ...process.env };
  afterEach(() => {
    for (const key of ['FACTUS_ENABLED', 'FACTUS_MOCK_MODE', 'FACTUS_ENV']) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  test('funciona sin credenciales cuando el modo mock está activo', async () => {
    process.env.FACTUS_ENABLED = 'true';
    process.env.FACTUS_MOCK_MODE = 'true';
    process.env.FACTUS_ENV = 'mock';
    const state = factus.status();
    expect(state).toEqual(expect.objectContaining({ enabled: true, configured: true, mock_mode: true, environment: 'mock' }));

    const pedido = {
      id: 20,
      numero: 'PED-20',
      subtotal: 10000,
      impuestos: 1900,
      descuento: 0,
      total: 13090,
      propina: 1190,
      Mesa: { numero: 4 },
      detalles: [{
        PlatoId: 1,
        cantidad: 1,
        precio_unitario: 10000,
        impuesto_codigo: '01',
        impuesto_tasa: 19,
        impuesto_excluido: false,
        Plato: { codigo: 'P1', nombre: 'Producto beta' },
      }],
    };
    const payload = factus.buildInvoicePayload({
      pedido,
      pago: { factus_payment_method_code: '10' },
      metodo: { nombre: 'Efectivo' },
      customerInput: { consumidor_final: true },
      sendEmail: false,
      referenceCode: 'RR-BETA-20',
    });
    expect(payload.payment_details[0].amount).toBe('11900.00');
    const result = await factus.createAndValidateInvoice(payload);
    expect(result.data.number).toMatch(/^BETA-/);
    expect(result.data.is_mock).toBe(true);
    expect(result.data.cufe).toMatch(/^CUFE-SIMULADO-/);
  });
});
