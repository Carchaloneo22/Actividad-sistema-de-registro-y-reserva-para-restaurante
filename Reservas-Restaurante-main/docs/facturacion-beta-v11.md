# Facturación beta V11

## Modos disponibles

| Configuración | Resultado |
|---|---|
| `FACTUS_ENABLED=false` | Comprobante interno. |
| `FACTUS_ENABLED=true`, `FACTUS_MOCK_MODE=true`, `FACTUS_ENV=mock` | Factura simulada local para la beta. |
| `FACTUS_ENABLED=true`, `FACTUS_MOCK_MODE=false`, `FACTUS_ENV=sandbox` | Integración real con Factus Sandbox; requiere credenciales. |
| `FACTUS_ENV=production` | Integración real de producción; requiere habilitación formal. |

## Factura simulada

La factura simulada se genera dentro del backend y se almacena en MySQL. No hace llamadas HTTP y no necesita `client_id`, `client_secret`, usuario ni contraseña.

El documento incluye:

- Número con prefijo `BETA`.
- CUFE claramente identificado como simulado.
- Detalle de platos.
- Subtotal antes de IVA.
- IVA del 19%.
- Descuento.
- Propina voluntaria del 10%, cuando el cliente la acepta.
- Total pagado.
- Aviso visible de que no es válida ante la DIAN.

## Propina

La interfaz deja la propina desmarcada. Despacho/caja debe preguntarle al cliente si desea incluir la propina sugerida del 10%. El backend ignora totales manipulados y calcula nuevamente el valor.

## Fórmulas

```text
IVA = subtotal gravado × 19%
Total consumo = subtotal + IVA - descuento
Propina = total consumo × 10% (solo cuando el cliente acepta)
Total pagado = total consumo + propina
```

La propina no se agrega a los ítems enviados a una integración real de Factus. Se registra por separado en `pedidos`, `facturas` y reportes.
