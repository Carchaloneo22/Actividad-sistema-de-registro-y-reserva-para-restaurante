const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../../.env');
const examplePath = path.resolve(__dirname, '../../.env.example');

if (!fs.existsSync(envPath)) {
  if (!fs.existsSync(examplePath)) throw new Error('No existe backend/.env ni backend/.env.example');
  fs.copyFileSync(examplePath, envPath);
  console.log('+ backend/.env creado desde .env.example');
}

const original = fs.readFileSync(envPath, 'utf8');
const backupPath = `${envPath}.antes-v11`;
if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, original, 'utf8');

const updates = {
  TAX_RATE: '0.19',
  TIP_RATE: '0.10',
  TIP_MAX_RATE: '0.10',
  FACTUS_ENABLED: 'true',
  FACTUS_MOCK_MODE: 'true',
  FACTUS_ENV: 'mock',
  FACTUS_DEFAULT_TAX_CODE: '01',
  FACTUS_DEFAULT_TAX_RATE: '19.00',
  FACTUS_TIMEOUT_MS: '15000',
};

let lines = original.replace(/\r\n/g, '\n').split('\n');
for (const [key, value] of Object.entries(updates)) {
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  const index = lines.findIndex((line) => pattern.test(line));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
}

fs.writeFileSync(envPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
console.log('Configuración V11 aplicada sin modificar las credenciales de MySQL, JWT ni cookies.');
console.log(`Respaldo del .env anterior: ${path.basename(backupPath)}`);
