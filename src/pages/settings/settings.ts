import { api, ApiError, logout, requireAuth } from '../../lib/api';

requireAuth();

const whatsappInput = document.getElementById('whatsapp-to') as HTMLInputElement;
const btnGuardar = document.getElementById('btn-guardar-whatsapp') as HTMLButtonElement;
const btnTest = document.getElementById('btn-test') as HTMLButtonElement;
const btnEmail = document.getElementById('btn-email') as HTMLButtonElement;
const btnReminders = document.getElementById('btn-reminders') as HTMLButtonElement;
const imapUser = document.getElementById('imap-user') as HTMLInputElement;
const imapPassword = document.getElementById('imap-password') as HTMLInputElement;
const btnGuardarImap = document.getElementById('btn-guardar-imap') as HTMLButtonElement;
const emailEstado = document.getElementById('email-estado') as HTMLParagraphElement;
const msgWhatsapp = document.getElementById('msg-whatsapp') as HTMLParagraphElement;
const msgEmail = document.getElementById('msg-email') as HTMLParagraphElement;
const msgReminders = document.getElementById('msg-reminders') as HTMLParagraphElement;

function mostrarMensaje(el: HTMLParagraphElement, texto: string, esError: boolean): void {
  el.textContent = texto;
  el.className = `aviso ${esError ? 'error' : 'ok'}`;
  el.hidden = false;
}

async function cargarSettings(): Promise<void> {
  const [settings, configEmail] = await Promise.all([api.obtenerSettings(), api.obtenerConfigEmail()]);
  whatsappInput.value = settings.whatsapp_to;
  emailEstado.textContent = configEmail.configurado
    ? 'La captura por email está configurada. Escaneá la casilla cuando quieras.'
    : 'La captura por email NO está configurada. Configurá tu casilla IMAP abajo.';
  imapUser.value = configEmail.user ?? '';
}

btnGuardar.addEventListener('click', async () => {
  btnGuardar.disabled = true;
  try {
    await api.guardarSettings(whatsappInput.value.trim());
    mostrarMensaje(msgWhatsapp, 'Número guardado.', false);
  } catch (err) {
    mostrarMensaje(msgWhatsapp, err instanceof ApiError ? err.message : 'Error inesperado', true);
  } finally {
    btnGuardar.disabled = false;
  }
});

btnTest.addEventListener('click', async () => {
  btnTest.disabled = true;
  msgWhatsapp.hidden = true;
  try {
    const resultado = await api.enviarMensajePrueba();
    mostrarMensaje(
      msgWhatsapp,
      resultado.enviado ? 'Mensaje de prueba enviado.' : `No se envió: ${resultado.motivo}`,
      !resultado.enviado
    );
  } catch (err) {
    mostrarMensaje(msgWhatsapp, err instanceof ApiError ? err.message : 'Error inesperado', true);
  } finally {
    btnTest.disabled = false;
  }
});

btnGuardarImap.addEventListener('click', async () => {
  const user = imapUser.value.trim();
  const password = imapPassword.value.trim();
  if (!user || !password) {
    mostrarMensaje(msgEmail, 'Email y contraseña de aplicación son obligatorios.', true);
    return;
  }
  btnGuardarImap.disabled = true;
  msgEmail.hidden = true;
  try {
    await api.guardarConfigEmail({
      host: 'imap.gmail.com',
      port: 993,
      user,
      password,
    });
    imapPassword.value = '';
    emailEstado.textContent = 'La captura por email está configurada. Escaneá la casilla cuando quieras.';
    mostrarMensaje(msgEmail, 'Casilla guardada.', false);
  } catch (err) {
    mostrarMensaje(msgEmail, err instanceof ApiError ? err.message : 'Error inesperado', true);
  } finally {
    btnGuardarImap.disabled = false;
  }
});

btnEmail.addEventListener('click', async () => {
  btnEmail.disabled = true;
  msgEmail.hidden = true;
  try {
    const resultado = await api.revisarEmail();
    if (resultado.motivo === 'imap_no_configurado') {
      mostrarMensaje(msgEmail, 'IMAP no configurado. Completá los datos de tu casilla y guardala.', true);
    } else if (resultado.motivo === 'ya_en_curso') {
      mostrarMensaje(msgEmail, 'Escaneo en curso o recién realizado. Probá de nuevo en unos minutos.', false);
    } else {
      mostrarMensaje(msgEmail, `Escaneo terminado. ${resultado.insertadas} factura(s) registrada(s).`, false);
    }
  } catch (err) {
    mostrarMensaje(msgEmail, err instanceof ApiError ? err.message : 'Error inesperado', true);
  } finally {
    btnEmail.disabled = false;
  }
});

btnReminders.addEventListener('click', async () => {
  btnReminders.disabled = true;
  msgReminders.hidden = true;
  try {
    const resultado = await api.ejecutarRecordatorios();
    mostrarMensaje(msgReminders, `Revisión terminada. ${resultado.avisos} aviso(s) procesado(s).`, false);
  } catch (err) {
    mostrarMensaje(msgReminders, err instanceof ApiError ? err.message : 'Error inesperado', true);
  } finally {
    btnReminders.disabled = false;
  }
});

document.getElementById('btn-logout')!.addEventListener('click', logout);

void cargarSettings();