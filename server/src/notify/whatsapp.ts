import twilio from 'twilio';
import { config } from '../config.js';
import { obtenerSetting } from '../facturas.js';

export interface ResultadoEnvio {
  enviado: boolean;
  motivo: string;
  to: string;
}

function normalizarNumero(numero: string): string {
  const limpio = numero.replace(/[\s\-()]/g, '');
  if (limpio.startsWith('whatsapp:')) return limpio;
  if (limpio.startsWith('+')) return `whatsapp:${limpio}`;
  return `whatsapp:+${limpio}`;
}

export async function enviarWhatsApp(numeroDestino: string, cuerpo: string): Promise<ResultadoEnvio> {
  const to = normalizarNumero(numeroDestino);
  const { accountSid, authToken, fromNumber } = config.twilio;

  if (!accountSid || !authToken) {
    console.log(`[whatsapp][skip] Credenciales Twilio no configuradas. Destino: ${to} | ${cuerpo}`);
    return { enviado: false, motivo: 'Twilio no configurado', to };
  }

  const client = twilio(accountSid, authToken);
  await client.messages.create({
    from: fromNumber,
    to,
    body: cuerpo,
  });
  console.log(`[whatsapp][ok] Enviado a ${to}: ${cuerpo}`);
  return { enviado: true, motivo: '', to };
}

export async function enviarWhatsAppConfigurado(cuerpo: string, userId: number): Promise<ResultadoEnvio> {
  const destino = (await obtenerSetting(userId, 'whatsapp_to')) ?? '';
  if (destino.trim() === '') {
    console.log('[whatsapp][skip] No hay número destino configurado (settings.whatsapp_to)');
    return { enviado: false, motivo: 'Sin número destino', to: '' };
  }
  return enviarWhatsApp(destino, cuerpo);
}