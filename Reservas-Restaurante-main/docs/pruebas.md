# Pruebas

Ejecute desde `backend`:

```powershell
npm.cmd test
npm.cmd run test:security
npm.cmd run audit:production
```

La suite incluye pruebas de salud, protección de rutas, CSRF, orígenes, sanitización, contaminación de prototipos y SSRF. La V10/V11 agrega pruebas para:

- Mapeo de medios de pago Factus.
- Construcción idempotente del payload.
- Consumidor final.
- Impuestos por producto.
- Rechazo de totales manipulados o inconsistentes.
- Factura simulada sin credenciales ni red.
- IVA del 19%.
- Propina voluntaria del 10% y rechazo de tasas superiores al máximo.

Las pruebas automáticas no emiten documentos reales. El modo mock genera únicamente datos locales identificados como simulados. La validación integral contra la API requiere credenciales sandbox del propietario de la cuenta Factus.

Antes de producción también deben probarse manualmente:

- Factura de consumidor final.
- Persona natural y persona jurídica.
- Efectivo, transferencia y tarjeta.
- Rechazo por datos fiscales incompletos.
- Reintento idempotente.
- Descarga de PDF y XML.
- Envío por correo.
- Caída temporal de Factus sin marcar el pedido como pagado.
- Permisos de administrador y despacho/caja.
