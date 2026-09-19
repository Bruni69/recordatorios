import { api, ApiError, getToken, setToken } from '../../lib/api';

if (getToken()) location.href = '/src/pages/dashboard/dashboard.html';

const loginForm = document.getElementById('login-form') as HTMLFormElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const loginError = document.getElementById('login-error') as HTMLParagraphElement;
const btnEntrar = document.getElementById('btn-entrar') as HTMLButtonElement;

const registerForm = document.getElementById('register-form') as HTMLFormElement;
const regEmailInput = document.getElementById('reg-email') as HTMLInputElement;
const regPasswordInput = document.getElementById('reg-password') as HTMLInputElement;
const registerError = document.getElementById('register-error') as HTMLParagraphElement;
const btnRegistrarse = document.getElementById('btn-registrarse') as HTMLButtonElement;

const tabEntrar = document.getElementById('tab-entrar') as HTMLButtonElement;
const tabRegistrarse = document.getElementById('tab-registrarse') as HTMLButtonElement;

function mostrarError(el: HTMLParagraphElement, err: unknown): void {
  el.textContent = err instanceof ApiError ? err.message : 'Error inesperado';
  el.hidden = false;
}

function irAlDashboard(): void {
  location.href = '/src/pages/dashboard/dashboard.html';
}

loginForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  loginError.hidden = true;
  btnEntrar.disabled = true;
  try {
    const resultado = await api.login(emailInput.value, passwordInput.value);
    setToken(resultado.token);
    irAlDashboard();
  } catch (err) {
    mostrarError(loginError, err);
  } finally {
    btnEntrar.disabled = false;
  }
});

registerForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  registerError.hidden = true;
  btnRegistrarse.disabled = true;
  try {
    const resultado = await api.register(regEmailInput.value, regPasswordInput.value);
    setToken(resultado.token);
    irAlDashboard();
  } catch (err) {
    mostrarError(registerError, err);
  } finally {
    btnRegistrarse.disabled = false;
  }
});

function cambiarPestana(modo: string): void {
  const esLogin = modo === 'login';
  loginForm.hidden = !esLogin;
  registerForm.hidden = esLogin;
  tabEntrar.classList.toggle('activa', esLogin);
  tabRegistrarse.classList.toggle('activa', !esLogin);
}

tabEntrar.addEventListener('click', () => cambiarPestana('login'));
tabRegistrarse.addEventListener('click', () => cambiarPestana('register'));