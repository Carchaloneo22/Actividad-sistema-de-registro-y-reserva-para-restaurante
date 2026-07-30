const demoCard = document.querySelector('#demoCard');
if (demoCard && ['localhost', '127.0.0.1'].includes(location.hostname)) demoCard.hidden = false;

const loginForm = document.querySelector('#loginForm');
const errorBox = document.querySelector('#error');

if (new URLSearchParams(location.search).has('expired')) {
  errorBox.textContent = 'Tu sesión terminó. Inicia sesión nuevamente.';
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.textContent = '';
  document.querySelectorAll('.field-error').forEach((element) => { element.textContent = ''; });

  const identifier = loginForm.identificador.value.trim();
  const password = loginForm.password.value;
  let valid = true;

  if (!identifier) {
    document.querySelector('[data-error="identificador"]').textContent = 'Escribe tu usuario o correo.';
    valid = false;
  }
  if (password.length < 8) {
    document.querySelector('[data-error="password"]').textContent = 'La contraseña debe tener al menos 8 caracteres.';
    valid = false;
  }
  if (!valid) return;

  const button = event.submitter;
  const label = button.querySelector('.button-label');
  button.disabled = true;
  label.textContent = 'Ingresando...';

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identificador: identifier, password }),
    });
    sessionStorage.setItem('user', JSON.stringify(data.user));
    location.href = '/index.html';
  } catch (error) {
    errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    label.textContent = 'Entrar';
  }
});

document.querySelector('#toggle').addEventListener('click', () => {
  const password = document.querySelector('#password');
  const button = document.querySelector('#toggle');
  const visible = password.type === 'text';
  password.type = visible ? 'password' : 'text';
  button.textContent = visible ? 'Ver' : 'Ocultar';
  button.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
});
