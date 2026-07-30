# Integración Factus y modo simulado

## Modo beta V11

ReservaRest puede generar una factura simulada sin credenciales ni conexiones externas. Configure:

```env
FACTUS_ENABLED=true
FACTUS_MOCK_MODE=true
FACTUS_ENV=mock
FACTUS_CLIENT_ID=
FACTUS_CLIENT_SECRET=
FACTUS_USERNAME=
FACTUS_PASSWORD=
FACTUS_DEFAULT_TAX_CODE=01
FACTUS_DEFAULT_TAX_RATE=19.00
TIP_RATE=0.10
TIP_MAX_RATE=0.10
```

En este modo:

1. El backend recalcula subtotal, IVA, descuento, propina y total.
2. Se genera un número con prefijo `BETA`.
3. Se genera un CUFE explícitamente simulado.
4. La factura se almacena en MySQL con proveedor `factus_mock` y estado `simulada`.
5. No se realiza ninguna solicitud a Factus ni a la DIAN.
6. La impresión muestra **FACTURA SIMULADA — BETA — NO VÁLIDA ANTE LA DIAN**.

## IVA y propina

La beta queda configurada con IVA del 19% para productos no excluidos. El precio del plato es el valor antes del impuesto.

La propina sugerida es del 10% del total del consumo y siempre se presenta desmarcada. Despacho/caja debe preguntarle al cliente antes de incluirla. El navegador solo envía la decisión; el valor se calcula en el backend.

```text
Total consumo = subtotal + IVA - descuento
Propina = total consumo × 10% (cuando el cliente acepta)
Total pagado = total consumo + propina
```

## Integración real

Cuando se obtengan credenciales oficiales, desactive el simulador:

```env
FACTUS_ENABLED=true
FACTUS_MOCK_MODE=false
FACTUS_ENV=sandbox
FACTUS_CLIENT_ID=
FACTUS_CLIENT_SECRET=
FACTUS_USERNAME=
FACTUS_PASSWORD=
FACTUS_NUMBERING_RANGE_ID=
```

Use `production` únicamente cuando el restaurante esté habilitado para emitir documentos reales. El backend mantiene OAuth, referencias idempotentes, verificación de totales, descarga de PDF/XML, correo y protección SSRF.

La propina se conserva separada del valor facturable de los productos; no se agrega como un ítem gravado en el payload real.

## Migración

```powershell
npm.cmd run migrate:factus
npm.cmd run configure:v11-beta
npm.cmd run migrate:v11
```

La migración agrega `propina` y `propina_porcentaje` a pedidos, `propina` a facturas, amplía los estados para el simulador y recalcula únicamente pedidos no pagados con IVA del 19%.

## Seguridad

- Las credenciales reales permanecen en `backend/.env`.
- El modo mock no abre conexiones salientes.
- Los precios, impuestos y propina se recalculan en el backend.
- Solamente administrador y despacho/caja pueden cobrar.
- Las facturas simuladas nunca se presentan como documentos DIAN.
