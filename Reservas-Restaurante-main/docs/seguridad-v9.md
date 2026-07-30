# Endurecimiento de seguridad V9

## Controles incorporados

- CSRF mediante patrón de doble envío firmado con HMAC. Todas las operaciones POST, PUT, PATCH y DELETE exigen la cookie `csrf_token` y el encabezado `X-CSRF-Token`.
- Validación del encabezado `Origin` y bloqueo de solicitudes marcadas por el navegador como `cross-site`.
- CORS con lista exacta de orígenes. No se utiliza `*` junto con credenciales.
- JWT limitado a HS256, con `issuer`, `audience`, `jti`, vencimiento y comprobación de tokens revocados.
- Cookies `httpOnly`, `SameSite=Strict`, `Secure` en producción y duración controlada.
- Rechazo de tráfico HTTP en producción cuando `FORCE_HTTPS=true`; Nginx realiza la redirección a HTTPS.
- Cambio obligatorio de la contraseña temporal antes de acceder a los módulos.
- Comparación bcrypt ficticia cuando el usuario no existe para reducir diferencias de tiempo en el login.
- Límite de 72 bytes para contraseñas, evitando el truncamiento silencioso propio de bcrypt.
- Rate limiting global y específico para el inicio de sesión.
- Validación de parámetros, consultas y cuerpos en todas las operaciones críticas.
- Límites de tamaño, profundidad, número de campos y cantidad de elementos por solicitud.
- Bloqueo de claves relacionadas con contaminación de prototipos: `__proto__`, `prototype` y `constructor`.
- Respuestas de validación sin devolver el valor de campos sensibles.
- Cabeceras de seguridad con Helmet, desactivación de `X-Powered-By` y respuestas de API sin caché.
- Identificador único `X-Request-Id` para rastrear errores y actividades.
- Logs de archivo y consola con ocultamiento de contraseñas, tokens, cookies y secretos.
- Auditoría con redacción de datos secretos.
- Errores de Sequelize traducidos sin revelar consultas SQL, nombres internos ni trazas en producción.
- Socket.IO protegido con JWT, token revocado, usuario activo y lista de orígenes.
- Límites de tiempo y tamaño para HTTP y Socket.IO, además de apagado controlado.
- En producción no se ejecuta `sequelize.sync()`. La estructura debe cambiarse mediante migraciones.
- Validación financiera adicional: pagos no efectivos deben coincidir con el total y tener referencia.
- Bloqueo de imágenes remotas; los platos solo aceptan rutas locales en `assets/` o `uploads/`.

## Protección SSRF

La versión actual no realiza solicitudes HTTP salientes para operar. Por eso su superficie SSRF activa es baja y la defensa principal es **no permitir solicitudes salientes por defecto**. La protección se vuelve imprescindible cuando se agreguen integraciones que acepten o construyan URLs, como facturación, WhatsApp, webhooks o descarga de recursos.

El archivo `backend/src/utils/ssrf.js` ofrece `safeHttpsGet()` para futuras integraciones, por ejemplo facturación electrónica, mensajería o servicios de proveedores. Esta función:

- Solo permite HTTPS y el puerto 443.
- Exige una lista de dominios autorizados en `SSRF_ALLOWED_HOSTS`.
- Bloquea credenciales dentro de la URL.
- Bloquea localhost, dominios internos y direcciones privadas, reservadas, link-local o de metadatos.
- Resuelve todas las direcciones DNS y rechaza el host si cualquiera apunta a una red bloqueada.
- Fija la conexión a una dirección previamente validada para reducir ataques de DNS rebinding.
- No sigue redirecciones.
- Limita el tiempo de espera y el tamaño de la respuesta.

Nunca se debe reemplazar `safeHttpsGet()` por un `fetch(urlDelUsuario)` directo.

## Variables nuevas

```env
ALLOWED_ORIGINS=https://restaurante.example.com
JWT_ISSUER=reservarest-api
JWT_AUDIENCE=reservarest-web
SESSION_COOKIE_HOURS=8
TRUST_PROXY=true
GLOBAL_RATE_LIMIT_MAX=300
LOGIN_RATE_LIMIT_MAX=10
SSRF_ALLOWED_HOSTS=
OUTBOUND_TIMEOUT_MS=5000
OUTBOUND_MAX_BYTES=1048576
LOG_PATH=./logs
DB_SSL=true
```

`SSRF_ALLOWED_HOSTS` debe quedar vacío mientras el sistema no tenga una integración externa. Para habilitar un proveedor, registrar solamente sus dominios exactos, separados por comas.

## Generar secretos de producción

```powershell
node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"
```

Ejecutar el comando dos veces: una para `JWT_SECRET` y otra para `COOKIE_SECRET`.

## Requisitos para producción

1. Servir frontend y API bajo el mismo dominio mediante Nginx.
2. Utilizar HTTPS. Las cookies seguras no funcionarán correctamente en producción sobre HTTP.
3. Configurar `NODE_ENV=production`, `TRUST_PROXY=true` y un único origen HTTPS autorizado.
4. Crear la base con `database/database.sql` antes del primer inicio. La migración heredada todavía no sustituye ese script; no ejecutar `sequelize.sync()` en producción.
5. Usar un usuario MySQL exclusivo con permisos solamente sobre la base del restaurante.
6. Ejecutar `npm audit --omit=dev`, revisar cada resultado y probar antes de actualizar dependencias.
7. Restringir el acceso de red a MySQL; no publicar el puerto 3306 en Internet.
8. Guardar `.env`, respaldos y logs fuera del directorio público.
9. Probar restauración de copias de seguridad.
10. Revisar logs, intentos fallidos y auditoría periódicamente.

## Limitación conocida de CSP

La interfaz heredada utiliza algunos atributos `onclick` en el HTML generado. Por compatibilidad, la política CSP del panel conserva `unsafe-inline` para scripts. La política sigue restringiendo dominios, objetos, imágenes y conexiones, pero una versión futura debe migrar todos los eventos a `addEventListener` para retirar `unsafe-inline` y obtener una CSP más estricta.

## Extensión V10 para Factus

La integración de facturación electrónica reutiliza el cliente HTTP protegido contra SSRF. Las conexiones salientes solo aceptan los hosts oficiales seleccionados por `FACTUS_ENV`, HTTPS por el puerto 443, resolución DNS pública, certificado TLS válido, respuesta limitada y redirecciones deshabilitadas. Las credenciales OAuth y los tokens nunca se envían al frontend ni se guardan en `localStorage`.
