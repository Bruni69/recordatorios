import 'dotenv/config';

const SECRETO_JWT_DEFECTO = 'secreto-local-cambiar';

function valorObligatorio(variable: string, valor: string | undefined, porDefectoConocido: string): string {
  if (!valor || valor === porDefectoConocido) return '';
  return valor;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  appPassword: valorObligatorio('APP_PASSWORD', process.env.APP_PASSWORD, 'admin'),
  adminEmail: (process.env.ADMIN_EMAIL ?? 'admin@recordatorios.local').trim().toLowerCase(),
  jwtSecret: valorObligatorio('JWT_SECRET', process.env.JWT_SECRET, SECRETO_JWT_DEFECTO),
  databaseUrl: process.env.DATABASE_URL ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  imap: {
    host: process.env.IMAP_HOST ?? '',
    port: Number(process.env.IMAP_PORT ?? 993),
    tls: true,
    user: process.env.IMAP_USER ?? '',
    password: process.env.IMAP_PASSWORD ?? '',
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    fromNumber: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
  },
  reminderCron: process.env.REMINDER_CRON ?? '0 9 * * *',

  smtp: {
    host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    password: process.env.SMTP_PASSWORD ?? '',
    from: process.env.SMTP_FROM ?? '',
  },
};

export function validarConfiguracion(): { ok: boolean; errores: string[] } {
  const errores: string[] = [];
  if (config.jwtSecret === '' || config.jwtSecret.length < 16) {
    errores.push('JWT_SECRET debe existir y tener al menos 16 caracteres (no usar el valor por defecto).');
  }
  return { ok: errores.length === 0, errores };
}