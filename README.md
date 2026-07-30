[README.md](https://github.com/user-attachments/files/30556284/README.md)
# ReservaRest

Sistema full stack para administrar mesas, reservas, pedidos, despacho, cocina, pagos, ventas, usuarios y auditoría de un restaurante.

## Arquitectura

Frontend HTML/CSS/JavaScript Vanilla → Fetch API → Express REST → controladores/servicios → Sequelize → MySQL. Socket.IO actualiza pedidos y notificaciones en tiempo real.

## Flujo por roles

- **Administrador:** configuración, usuarios, mesas, menú, operación, ventas, reportes y auditoría.
- **Despacho / Caja:** crea reservas, confirma llegadas, recibe pedidos, los envía a cocina, verifica lo preparado, avisa al mesero y registra pagos.
- **Mesero:** ocupa mesas disponibles, toma pedidos, agrega adicionales, recibe el aviso de despacho, recoge y entrega al cliente.
- **Cocina:** recibe pedidos enviados por despacho, prepara productos y marca el pedido como listo para revisión.

## Inicio local sin Docker

```powershell
cd backend
npm.cmd install
npm.cmd run seed
npm.cmd run dev
```

En una segunda terminal, desde la raíz:

```powershell
npx.cmd http-server frontend -p 8080 -c-1
```

Abrir `http://localhost:8080/login.html`.

## Inicio local con Docker

1. Copia `.env.docker.example` como `.env.docker` y cambia las claves.
2. Ajusta `backend/.env` para usar `DB_HOST=mysql`.
3. Ejecuta:

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker exec backend npm run seed
```

## Seguridad V9

La versión V9 incorpora CSRF firmado, cookies seguras, JWT endurecido, control de origen, rate limiting, validación y sanitización, protección contra contaminación de prototipos, controles IDOR por rol, logs con secretos ocultos, seguridad de Socket.IO y protección preventiva contra SSRF.

Consulta `docs/seguridad-v9.md` y ejecuta desde `backend`:

```powershell
npm.cmd test
npm.cmd run test:security
npm.cmd run audit:production
```

También puedes ejecutar `VERIFICAR_SEGURIDAD_V9.cmd` desde la raíz.

Las credenciales demo solo se muestran en localhost. El seed de demostración queda bloqueado en producción y cada usuario debe cambiar su contraseña temporal.

## Facturación electrónica Factus V10

La V10 permite que administrador y despacho/caja emitan una factura electrónica desde el cobro de un pedido. La integración incluye:

- OAuth ejecutado exclusivamente en el backend.
- Entornos sandbox y producción.
- Consumidor final o adquiriente identificado.
- Impuesto, tarifa, unidad y código estándar por plato.
- Referencia idempotente por pedido.
- Validación antes de confirmar el pago local.
- Almacenamiento de número oficial, CUFE y trazabilidad.
- Descarga de PDF y XML.
- Envío por correo.
- Conexiones salientes protegidas contra SSRF.

Para actualizar una instalación existente:

```powershell
cd backend
npm.cmd install
npm.cmd run migrate:factus
npm.cmd test
npm.cmd run dev
```

Configure las variables `FACTUS_*` de `backend/.env.example` y empiece siempre en `FACTUS_ENV=sandbox`. Consulte `docs/factus.md`. Para la versión beta sin credenciales use la configuración V11 descrita a continuación.

## Facturación beta V11

La V11 agrega un modo local de factura simulada para demostraciones sin credenciales externas:

- `FACTUS_MOCK_MODE=true` y `FACTUS_ENV=mock`.
- Número de factura con prefijo `BETA` y CUFE identificado como simulado.
- Aviso permanente **FACTURA SIMULADA — BETA — NO VÁLIDA ANTE LA DIAN**.
- IVA predeterminado del 19% para productos no excluidos.
- Propina sugerida del 10%, voluntaria y desmarcada por defecto.
- Totales recalculados en el backend.
- Impresión de la factura beta y reportes separados de propinas.

Para actualizar una instalación V10:

```powershell
cd backend
npm.cmd install
npm.cmd run migrate:factus
npm.cmd run configure:v11-beta
npm.cmd run migrate:v11
npm.cmd test
npm.cmd run dev
```

También puede ejecutar `ACTUALIZAR_V11_BETA.cmd`. El configurador conserva las credenciales existentes y crea `backend/.env.antes-v11` como respaldo. Consulte `docs/facturacion-beta-v11.md`.
