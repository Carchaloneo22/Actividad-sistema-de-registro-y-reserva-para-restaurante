# API REST

Todas las respuestas usan la estructura:

```json
{
  "success": true,
  "message": "Operación realizada correctamente",
  "data": {},
  "errors": []
}
```

Las rutas protegidas requieren la cookie de sesión JWT y las operaciones mutables requieren el encabezado CSRF generado por `GET /api/auth/csrf`.

## Autenticación

- `GET /api/auth/csrf`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`

## Operación

- `GET /api/dashboard`
- `GET|POST /api/mesas`
- `PUT|DELETE /api/mesas/:id`
- `POST /api/mesas/:id/ocupar`
- `POST /api/mesas/:id/liberar`
- `GET|POST /api/reservas`
- `POST /api/reservas/:id/llegada`
- `POST /api/reservas/:id/cancelar`
- `POST /api/reservas/:id/completar`
- `GET|POST /api/pedidos`
- `POST /api/pedidos/:id/items`
- `PATCH /api/pedidos/:id/estado`
- `PATCH /api/detalles-pedido/:id/estado`

## Pagos y facturación

### Estado de Factus

`GET /api/facturacion/factus/estado`

Roles: administrador y despacho.

Devuelve si la integración está activa, configurada, el entorno, `mock_mode` y el rango configurado. Nunca devuelve secretos.

### Rangos de numeración

`GET /api/facturacion/factus/rangos`

Rol: administrador.

Consulta los rangos asociados al software directamente en Factus.

### Registrar pago

`POST /api/pedidos/:id/pagar`

Roles: administrador y despacho.

Ejemplo beta con IVA del 19% y propina aceptada del 10%:

```json
{
  "MetodoPagoId": 1,
  "valor": 13090,
  "referencia": "",
  "emitir_factus": true,
  "incluir_propina": true,
  "factus_payment_method_code": "10",
  "enviar_email": false,
  "factus_customer": {
    "consumidor_final": true
  }
}
```

Para un subtotal de 10000, el backend calcula IVA 1900, consumo 11900, propina 1190 y total 13090. La propina se omite cuando `incluir_propina` es `false`.

Ejemplo con cliente identificado:

```json
{
  "MetodoPagoId": 3,
  "valor": 11900,
  "referencia": "AUT-987654",
  "emitir_factus": true,
  "factus_payment_method_code": "48",
  "enviar_email": true,
  "factus_customer": {
    "consumidor_final": false,
    "identification_document_code": "13",
    "identification": "1098765432",
    "legal_organization_code": "2",
    "tribute_code": "ZZ",
    "names": "Cliente de prueba",
    "email": "cliente@example.com",
    "phone": "3000000000",
    "address": "Dirección del cliente",
    "country_code": "CO",
    "municipality_code": "68001"
  }
}
```

El backend vuelve a calcular precios, impuestos, propina y total. En modo mock genera una factura `factus_mock` con estado `simulada`; en modo real, si Factus no valida la factura, el pago no se confirma localmente.

### Descargar documento

- `GET /api/facturas/:id/pdf`
- `GET /api/facturas/:id/xml`

Roles: administrador y despacho. Solo permite facturas Factus validadas.

### Enviar factura por correo

`POST /api/facturas/:id/enviar-correo`

```json
{
  "email": "cliente@example.com"
}
```

## Administración

- `GET|POST /api/usuarios`
- `PATCH /api/usuarios/:id/estado`
- `GET /api/reportes/ventas`
- `GET /api/auditoria`
- `GET /api/notificaciones`
