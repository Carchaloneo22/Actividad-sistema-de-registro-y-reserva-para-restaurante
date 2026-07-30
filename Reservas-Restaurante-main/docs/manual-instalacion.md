# Manual de instalación

## Instalación local sin Docker

1. Instale Node.js 20 o superior y MySQL 8.
2. Cree la base con `database/database.sql`.
3. Copie `backend/.env.example` como `backend/.env`.
4. Configure MySQL, JWT, cookies, origen del frontend y demás variables.
5. Desde `backend` ejecute:

```powershell
npm.cmd install
npm.cmd run seed
npm.cmd run dev
```

6. En una segunda terminal, desde la raíz:

```powershell
npx.cmd http-server frontend -p 8080 -c-1
```

7. Abra `http://localhost:8080/login.html`.

## Actualizar una instalación existente a Factus V10

Haga primero una copia de seguridad. Después reemplace los archivos del proyecto, conserve `backend/.env` y `backend/node_modules`, y ejecute:

```powershell
cd backend
npm.cmd install
npm.cmd run migrate:factus
npm.cmd test
npm.cmd run dev
```

Agregue al `.env` las variables `FACTUS_*` de `.env.example`. Empiece con:

```env
FACTUS_ENABLED=true
FACTUS_ENV=sandbox
```

Complete las credenciales entregadas por Factus. Consulte `docs/factus.md`.


## Actualizar a V11 Beta

La actualización conserva MySQL, usuarios, reservas, pedidos pagados y credenciales. Antes de iniciar, detenga las dos terminales y haga una copia de seguridad.

Desde la raíz puede ejecutar `ACTUALIZAR_V11_BETA.cmd`, o usar:

```powershell
cd backend
npm.cmd install
npm.cmd run migrate:factus
npm.cmd run configure:v11-beta
npm.cmd run migrate:v11
npm.cmd test
npm.cmd run dev
```

El configurador crea `backend/.env.antes-v11` y cambia únicamente las variables de IVA, propina y Factus mock. Los datos de MySQL, JWT y cookies permanecen intactos.

El frontend se inicia en otra terminal:

```powershell
npx.cmd http-server frontend -p 8080 -c-1
```

La beta usa `FACTUS_ENV=mock`; no requiere credenciales ni conexión a Factus.

## Docker

1. Copie `.env.docker.example` como `.env.docker` y cambie todas las claves.
2. Copie `backend/.env.example` como `backend/.env` y use `DB_HOST=mysql`.
3. Ejecute:

```bash
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker exec backend npm run migrate:factus
docker compose --env-file .env.docker exec backend npm run seed
```

4. Abra `http://localhost:8080`.

## Producción

- Configure dominio, Nginx y certificado TLS.
- Use `NODE_ENV=production`, `TRUST_PROXY=true` y `FORCE_HTTPS=true`.
- Use secretos aleatorios de mínimo 64 caracteres.
- Mantenga MySQL fuera de Internet.
- Active Factus en producción únicamente después de probar sandbox y revisar los impuestos con el contador.
- Nunca conserve credenciales demo.
- Automatice copias de seguridad y pruebe su restauración.
