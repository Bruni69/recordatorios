import cron from 'node-cron';
import { config } from '../config.js';
import { facturasPendientesProximas, reclamarAviso, liberarAviso, emailsDeUsuarios } from '../facturas.js';
import type { ColumnaAviso } from '../facturas.js';
import { enviarEmailAviso } from '../notify/emailNotify.js';
import { escanearCasillasConfiguradas } from '../email/scheduler.js';

export function formatearFecha(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a!, m! - 1, d!).toLocaleDateString('es-AR');
}

export function diasHasta(iso: string): number {
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}

export function formatearMonto(monto: number, moneda: string): string {
  const literal = monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (moneda === 'USD') return `USD ${literal}`;
  if (moneda === 'OTRA') return `OTRA ${literal}`;
  return `$${literal}`;
}

interface AvisoPendiente {
  columna: ColumnaAviso;
  asunto: string;
  cuerpo: string;
}

function armarAvisos(
  fechaVencimiento: string,
  proveedor: string,
  monto: number,
  moneda: string,
  aviso72: boolean,
  aviso48: boolean
): AvisoPendiente[] {
  const avisos: AvisoPendiente[] = [];
  const dias = diasHasta(fechaVencimiento);

  if (dias === 3 && !aviso72) {
    avisos.push({
      columna: 'aviso_72hs_enviado',
      asunto: `⏰ Recordatorio: factura de ${proveedor} vence en 72 horas`,
      cuerpo: [
        `⏰ RECORDATORIO -72 horas`,
        ``,
        `Tu factura de ${proveedor}`,
        `por ${formatearMonto(monto, moneda)}`,
        `vence el ${formatearFecha(fechaVencimiento)}.`,
        `Quedan 3 días para el vencimiento.`,
      ].join('\n'),
    });
  }
  if (dias >= 0 && dias <= 2 && !aviso48) {
    avisos.push({
      columna: 'aviso_48hs_enviado',
      asunto: `🚨 Urgente: factura de ${proveedor} vence ${dias === 0 ? 'hoy' : `en ${dias} día(s)`}`,
      cuerpo: [
        `🚨 RECORDATORIO -48 horas`,
        ``,
        `Tu factura de ${proveedor}`,
        `por ${formatearMonto(monto, moneda)}`,
        `vence ${formatearFecha(fechaVencimiento)}.`,
        `Este aviso corresponde al plazo de 48 horas antes del vencimiento.`,
      ].join('\n'),
    });
  }
  return avisos;
}

export async function revisarVencimientos(userId?: number): Promise<number> {
  const proximas = await facturasPendientesProximas([0, 1, 2, 3], userId);
  const duenos = [...new Set(proximas.map((f) => f.user_id))];
  const emails = await emailsDeUsuarios(duenos);
  let avisos = 0;
  let fallidos = 0;

  for (const factura of proximas) {
    const pendientes = armarAvisos(
      factura.fecha_vencimiento,
      factura.proveedor,
      factura.monto,
      factura.moneda,
      factura.aviso_72hs_enviado,
      factura.aviso_48hs_enviado
    );

    for (const pendiente of pendientes) {
      const reclamado = await reclamarAviso(factura.user_id, factura.id, pendiente.columna);
      if (!reclamado) continue;

      const destino = emails.get(factura.user_id) ?? '';
      if (destino === '') {
        console.log(`[reminders][envio][skip] Factura ${factura.id}: el dueño no tiene email.`);
        await liberarAviso(factura.user_id, factura.id, pendiente.columna);
        continue;
      }

      let enviado = false;
      try {
        enviado = (await enviarEmailAviso(destino, pendiente.asunto, pendiente.cuerpo, factura.user_id)).enviado;
      } catch (err) {
        console.error(`[reminders][envio][error] Factura ${factura.id} (${pendiente.columna}):`, err);
      }
      if (!enviado) {
        fallidos += 1;
        await liberarAviso(factura.user_id, factura.id, pendiente.columna);
        continue;
      }
      avisos += 1;
    }
  }

  if (avisos > 0) console.log(`[reminders] ${avisos} aviso(s) enviado(s).`);
  if (fallidos > 0 && userId !== undefined) {
    throw new Error(`No se pudieron enviar ${fallidos} aviso(s). Verificá la conexión y las credenciales de tu casilla o SMTP. Los envíos fallidos se reintentarán.`);
  }
  return avisos;
}

export function iniciarScheduler(): void {
  const registrar = (expresion: string, nombre: string, trabajo: () => Promise<unknown>): void => {
    if (!cron.validate(expresion)) throw new Error(`${nombre}: expresión cron inválida`);
    cron.schedule(expresion, () => {
      trabajo().catch((err) => console.error(`[${nombre}]`, err));
    }, { timezone: config.timezone });
    console.log(`[${nombre}] Programado: ${expresion} (${config.timezone})`);
  };
  registrar(config.emailScanCron, 'email', async () => {
    await escanearCasillasConfiguradas();
    await revisarVencimientos();
  });
  registrar(config.reminderCron, 'reminders', revisarVencimientos);
}

export async function ejecutarRevisionInicial(): Promise<void> {
  // Los avisos existentes no esperan a que termine una conexión IMAP lenta.
  await revisarVencimientos();
  await escanearCasillasConfiguradas();
  await revisarVencimientos();
}
