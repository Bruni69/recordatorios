import cron from 'node-cron';
import { config } from '../config.js';
import { facturasPendientesProximas, reclamarAviso, liberarAviso, emailsDeUsuarios } from '../facturas.js';
import type { ColumnaAviso } from '../facturas.js';
import { enviarEmailAviso } from '../notify/emailNotify.js';

export function formatearFecha(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a!, m! - 1, d!).toLocaleDateString('es-AR');
}

export function diasHasta(iso: string): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const [a, m, d] = iso.split('-').map(Number);
  const vencimiento = new Date(a!, m! - 1, d!);
  vencimiento.setHours(0, 0, 0, 0);
  return Math.round((vencimiento.getTime() - hoy.getTime()) / 86_400_000);
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
  avisoSemana: boolean,
  aviso48: boolean
): AvisoPendiente[] {
  const avisos: AvisoPendiente[] = [];
  const dias = diasHasta(fechaVencimiento);

  if (dias === 7 && !avisoSemana) {
    avisos.push({
      columna: 'aviso_semana_enviado',
      asunto: `⏰ Recordatorio: factura de ${proveedor} vence en 7 días`,
      cuerpo: [
        `⏰ RECORDATORIO -7 días`,
        ``,
        `Tu factura de ${proveedor}`,
        `por ${formatearMonto(monto, moneda)}`,
        `vence el ${formatearFecha(fechaVencimiento)}.`,
        `Quedan 7 días.`,
      ].join('\n'),
    });
  }
  if (dias === 2 && !aviso48) {
    avisos.push({
      columna: 'aviso_48hs_enviado',
      asunto: `🚨 Urgente: factura de ${proveedor} vence en 48 horas`,
      cuerpo: [
        `🚨 RECORDATORIO -48 horas`,
        ``,
        `Tu factura de ${proveedor}`,
        `por ${formatearMonto(monto, moneda)}`,
        `vence ${formatearFecha(fechaVencimiento)}.`,
        `Te quedan 48 horas para pagar.`,
      ].join('\n'),
    });
  }
  return avisos;
}

export async function revisarVencimientos(): Promise<number> {
  const proximas = await facturasPendientesProximas([7, 2]);
  console.log('[reminders][debug] Facturas próximas:', proximas.length, JSON.stringify(proximas));
  const duenos = [...new Set(proximas.map((f) => f.user_id))];
  const emails = await emailsDeUsuarios(duenos);
  let avisos = 0;

  for (const factura of proximas) {
    const pendientes = armarAvisos(
      factura.fecha_vencimiento,
      factura.proveedor,
      factura.monto,
      factura.moneda,
      factura.aviso_semana_enviado,
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
        enviado = (await enviarEmailAviso(destino, pendiente.asunto, pendiente.cuerpo)).enviado;
      } catch (err) {
        console.error(`[reminders][envio][error] Factura ${factura.id} (${pendiente.columna}):`, err);
      }
      if (!enviado) {
        await liberarAviso(factura.user_id, factura.id, pendiente.columna);
        continue;
      }
      avisos += 1;
    }
  }

  if (avisos > 0) console.log(`[reminders] ${avisos} aviso(s) enviado(s).`);
  return avisos;
}

export function iniciarScheduler(): void {
  if (!cron.validate(config.reminderCron)) {
    console.error(`[reminders] Cron inválido: ${config.reminderCron}. No se programa el trabajo.`);
    return;
  }
  cron.schedule(config.reminderCron, () => {
    revisarVencimientos().catch((err) => console.error('[reminders][error]', err));
  });
  console.log(`[reminders] Trabajo programado: ${config.reminderCron}`);
}