import { api, ApiError, logout, requireAuth } from '../../lib/api';

requireAuth();

const whatsappInput = document.getElementById('whatsapp-to') as HTMLInputElement;
const btnGuardar = document.getElementById('btn-guardar-whatsapp') as HTMLButtonElement;
const btnTest = document.getElementById('btn-test') as HTMLButtonElement;
const btnEmail = document.getElementById('btn-email') as HTMLButtonElement;
const btnReminders = document.getElementById('btn-reminders') as HTMLButtonElement;
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
  const settings = await api.obtenerSettings();
  whatsappInput.value = settings.whatsapp_to;
  emailEstado.textContent = settings.email_configurado
    ? 'La captura por email está configurada. Escaneá la casilla cuando quieras.'
    : 'La captura por email NO está configurada. Configurá tu casilla IMAP (o completá los datos en el .env del servidor).';
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

btnEmail.addEventListener('click', async () => {
  btnEmail.disabled = true;
  msgEmail.hidden = true;
  try {
    const resultado = await api.revisarEmail();
    mostrarMensaje(msgEmail, `Escaneo terminado. ${resultado.insertadas} factura(s) registrada(s).`, false);
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