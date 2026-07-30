# Manual técnico
Arquitectura en capas: rutas → controladores → servicios → modelos Sequelize. La autenticación usa JWT en cookie httpOnly. Los permisos se verifican en middleware y el menú también se limita en frontend. Socket.IO publica cambios de estado. Los procesos críticos de pedido y pago usan transacciones.

## Producción
Use Nginx como proxy inverso, HTTPS obligatorio, secretos robustos, usuario MySQL con privilegios mínimos, rotación de logs, copias automáticas y monitoreo. La facturación electrónica oficial requiere integración con proveedor autorizado y cumplimiento tributario aplicable.


## Facturación V11

`billingService.js` calcula el total del consumo y la propina voluntaria sin confiar en el navegador. `factusMockService.js` genera documentos beta locales. `factusService.js` selecciona entre mock, sandbox y producción según el entorno. La propina se guarda separada del subtotal e IVA.
