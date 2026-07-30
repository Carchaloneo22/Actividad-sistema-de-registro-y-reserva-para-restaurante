process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-only-for-automated-tests';
process.env.COOKIE_SECRET = 'test-cookie-secret-only-for-automated-tests';
process.env.FRONTEND_URL = 'http://localhost:8080';
process.env.ALLOWED_ORIGINS = 'http://localhost:8080';

const request = require('supertest');
const app = require('../src/app');
const { isBlockedIp, parseAndValidateUrl, assertLocalAssetPath } = require('../src/utils/ssrf');
const { sanitizeObject } = require('../src/middlewares/security');

function cookieValue(setCookie, name) {
  const row = (setCookie || []).find((item) => item.startsWith(`${name}=`));
  return row ? row.split(';')[0].slice(name.length + 1) : null;
}

describe('Endurecimiento HTTP', () => {
  test('entrega cabeceras de seguridad y un identificador de solicitud', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.headers['cache-control']).toContain('no-store');
  });

  test('emite un token CSRF firmado', async () => {
    const response = await request(app).get('/api/auth/csrf');
    expect(response.status).toBe(200);
    const token = cookieValue(response.headers['set-cookie'], 'csrf_token');
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  test('bloquea solicitudes mutables sin CSRF', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:8080')
      .send({ identificador: 'admin', password: 'Demo2026*' });
    expect(response.status).toBe(403);
    expect(response.body.message).toContain('CSRF');
  });

  test('bloquea orígenes no autorizados', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ identificador: 'admin', password: 'Demo2026*' });
    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Origen');
  });

  test('acepta CSRF válido y luego exige autenticación', async () => {
    const csrfResponse = await request(app).get('/api/auth/csrf');
    const cookie = csrfResponse.headers['set-cookie'][0].split(';')[0];
    const token = cookieValue(csrfResponse.headers['set-cookie'], 'csrf_token');
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'http://localhost:8080')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({});
    expect(response.status).toBe(401);
  });
});

describe('Protección SSRF', () => {
  test.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '192.168.1.20', '::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::'])('bloquea la IP %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  test('permite direcciones públicas conocidas', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false);
  });

  test('bloquea localhost incluso si está en una URL HTTPS', () => {
    expect(() => parseAndValidateUrl('https://localhost/private', ['localhost'])).toThrow(/interno/i);
  });

  test('exige allowlist para cualquier host externo', () => {
    expect(() => parseAndValidateUrl('https://example.com/data', [])).toThrow(/autorizado/i);
  });

  test('rechaza HTTP y credenciales embebidas', () => {
    expect(() => parseAndValidateUrl('http://example.com', ['example.com'])).toThrow(/HTTPS/i);
    expect(() => parseAndValidateUrl('https://user:pass@example.com', ['example.com'])).toThrow(/credenciales/i);
  });
});


describe('Sanitización y rutas locales', () => {
  test('retira etiquetas HTML de campos de texto', () => {
    const body = { nombre: '<img src=x onerror=alert(1)>Daniel<script>alert(1)</script>' };
    sanitizeObject(body);
    expect(body.nombre).not.toMatch(/<|>|script|onerror/i);
    expect(body.nombre).toContain('Daniel');
  });

  test('no modifica contraseñas durante la sanitización', () => {
    const body = { password: 'Clave<Segura>2026*' };
    sanitizeObject(body);
    expect(body.password).toBe('Clave<Segura>2026*');
  });

  test('rechaza contaminación de prototipos', () => {
    const body = JSON.parse('{"constructor":{"prototype":{"admin":true}}}');
    expect(() => sanitizeObject(body)).toThrow(/Campo no permitido/i);
  });

  test('solo admite imágenes locales controladas', () => {
    expect(assertLocalAssetPath('assets/platos/generico.svg')).toBe('assets/platos/generico.svg');
    expect(() => assertLocalAssetPath('https://evil.example/imagen.jpg')).toThrow(/archivo local/i);
    expect(() => assertLocalAssetPath('../secreto.env')).toThrow(/inválida/i);
  });
});
