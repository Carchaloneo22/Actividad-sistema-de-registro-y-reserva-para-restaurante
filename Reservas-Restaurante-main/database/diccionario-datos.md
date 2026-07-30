# Diccionario de datos

El modelo incluye: roles, usuarios, meseros, mesas, categorías, platos, clientes, reservas, pedidos, detalle_pedidos, historial_pedidos, métodos_pago, pagos, facturas, configuración_restaurante, auditoría, notificaciones, tokens_revocados y copias_seguridad.

Las claves primarias son enteros autoincrementales. Las relaciones se implementan mediante claves foráneas generadas por Sequelize. Los importes usan `DECIMAL(12,2)`, los estados usan `ENUM`, las eliminaciones administrativas se realizan mediante `activo`, y todas las tablas operativas incluyen `created_at` y `updated_at`.

## Campos de facturación electrónica V10/V11

### platos

| Campo | Tipo | Descripción |
|---|---|---|
| factus_tax_code | VARCHAR(4) | Código de impuesto enviado por producto; V11 usa `01` para IVA. |
| factus_tax_rate | DECIMAL(5,2) | Tarifa porcentual; V11 usa 19% por defecto. |
| factus_is_excluded | BOOLEAN | Indica si el producto está excluido. |
| factus_unit_measure_code | VARCHAR(10) | Unidad de medida Factus. |
| factus_standard_code | VARCHAR(10) | Estándar de identificación del producto. |

### clientes

| Campo | Tipo | Descripción |
|---|---|---|
| tipo_documento_codigo | VARCHAR(4) | Tipo de identificación. |
| organizacion_legal_codigo | VARCHAR(2) | Persona jurídica o natural. |
| tributo_codigo | VARCHAR(4) | Responsabilidad tributaria. |
| razon_social | VARCHAR(160) | Razón social para persona jurídica. |
| nombre_comercial | VARCHAR(160) | Nombre comercial opcional. |
| digito_verificacion | VARCHAR(2) | DV para NIT. |
| direccion | VARCHAR(180) | Dirección fiscal. |
| pais_codigo | VARCHAR(3) | Código de país. |
| municipio_codigo | VARCHAR(10) | Código DIAN del municipio. |

### detalle_pedidos

Los campos `impuesto_codigo`, `impuesto_tasa`, `impuesto_valor`, `impuesto_excluido`, `unidad_medida_codigo` y `codigo_estandar` guardan una copia tributaria del producto en el momento del pedido.

### pagos

`factus_payment_method_code` conserva el código del medio de pago enviado al proveedor.

### pedidos

| Campo | Tipo | Descripción |
|---|---|---|
| propina | DECIMAL(12,2) | Valor voluntario aceptado por el cliente. |
| propina_porcentaje | DECIMAL(5,2) | Porcentaje aplicado; 0 o 10 en la beta. |

### facturas

| Campo | Descripción |
|---|---|
| proveedor | `local`, `factus` o `factus_mock`. |
| estado_electronico | Incluye `simulada` para documentos beta. |
| referencia_externa | Referencia idempotente y única. |
| cufe | Código único de factura electrónica. |
| url_publica | Enlace público cuando el proveedor lo devuelve. |
| url_qr | Enlace o dato QR cuando está disponible. |
| validada_en | Fecha y hora de validación. |
| enviada_email | Indica si fue enviada por correo. |
| errores_proveedor | Detalle estructurado de errores. |
| respuesta_proveedor | Respuesta técnica almacenada para trazabilidad. |
| propina | Valor voluntario separado del consumo facturable. |


### configuracion_restaurantes

| Campo | Tipo | Descripción |
|---|---|---|
| impuesto | DECIMAL(5,4) | Tarifa general configurada; V11 usa 0.19. |
| propina_sugerida | DECIMAL(5,4) | Sugerencia voluntaria; V11 usa 0.10. |
