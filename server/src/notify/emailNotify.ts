import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { obtenConfigImap } from '../facturas.js';

export interface ResultadoEnvio {
  enviado: boolean;
  motivo: string;
  to: string;
}

async function obtenerSmtp(userId: number) {
  if (config.smtp.user && config.smtp.password) {
    return { ...config.smtp, from: config.smtp.from || config.smtp.user };
  }
  // Gmail permite usar la misma contraseña de aplicación para IMAP y SMTP.
  const imap = await obtenConfigImap(userId);
  if (imap?.host.toLowerCase() === 'imap.gmail.com') {
    return { host: 'smtp.gmail.com', port: 465, user: imap.user, password: imap.password, from: imap.user };
  }
  return null;
}

export async function emailAvisosConfigurado(userId: number): Promise<boolean> {
  return (await obtenerSmtp(userId)) !== null;
}

export async function enviarEmailAviso(destinatario: string, asunto: string, cuerpo: string, userId: number): Promise<ResultadoEnvio> {
  const smtp = await obtenerSmtp(userId);
  if (!smtp) return { enviado: false, motivo: 'Configurá Gmail con una contraseña de aplicación o las variables SMTP_USER y SMTP_PASSWORD del servidor.', to: destinatario };

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
  try {
    await transporter.sendMail({ from: smtp.from, to: destinatario, subject: asunto, text: cuerpo });
    return { enviado: true, motivo: '', to: destinatario };
  } catch {
    // No volcar objetos del cliente SMTP que puedan contener datos de acceso.
    console.error('[email] Falló el envío. Verificá conexión y credenciales SMTP.');
    return { enviado: false, motivo: 'No se pudo enviar el email. Verificá conexión y credenciales SMTP.', to: destinatario };
  } finally {
    transporter.close();
  }
}
