import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { emailConfiguradoCompletoBd, obtenConfigImap } from '../facturas.js';
import { DatoFacturaEmail, Moneda } from '../models.js';
import { obtenerUidsProcesados, registrarEmailProcesado } from './procesados.js';

interface DocEmail {
  subject: string;
  from: string;
  body: string;
}

async function textoDePdf(buffer: Buffer): Promise<string> {
  try {
    const documento = await getDocument({ data: new Uint8Array(buffer) }).promise;
    let texto = '';
    for (let pagina = 1; pagina <= documento.numPages; pagina += 1) {
      const contenido = await documento.getPage(pagina).then((p) => p.getTextContent());
      texto += contenido.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    }
    return texto;
  } catch {
    return '';
  }
}

const escaneosEnCurso = new Set<number>();

export interface ResultadoEscaneo {
  insertadas: number;
  motivo: 'ok' | 'imap_no_configurado' | 'ya_en_curso';
}

export async function escanearInbox(userId: number): Promise<ResultadoEscaneo> {
  if (!(await emailConfiguradoCompletoBd(userId))) {
    console.log('[email][skip] IMAP no configurado (ni .env ni base de datos)');
    return { insertadas: 0, motivo: 'imap_no_configurado' };
  }
  if (escaneosEnCurso.has(userId)) {
    console.log('[email][skip] Escaneo ya en curso para este usuario, se omite.');
    return { insertadas: 0, motivo: 'ya_en_curso' };
  }
  escaneosEnCurso.add(userId);
  try {
    const insertadas = await escanearCasilla(userId);
    return { insertadas, motivo: 'ok' };
  } finally {
    escaneosEnCurso.delete(userId);
  }
}

async function escanearCasilla(userId: number): Promise<number> {
  const imap = await obtenConfigImap(userId);
  if (!imap) return 0;
  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.port === 993,
    auth: { user: imap.user, pass: imap.password },
    logger: false,
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });

  await client.connect();
  let insertadas = 0;

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      if (!client.mailbox) throw new Error('No se pudo abrir INBOX');
      const casilla = {
        userId,
        casilla: JSON.stringify([imap.host.toLowerCase(), imap.port, imap.user.toLowerCase(), 'INBOX']),
        uidValidity: String(client.mailbox.uidValidity),
      };
      const procesados = await obtenerUidsProcesados(casilla);
      // También incluye correos que el usuario ya abrió. El historial de UID
      // persiste en PostgreSQL; no depende de la marca de lectura del correo.
      const desde = new Date(Date.now() - 90 * 86_400_000);
      const uids = await client.search({ since: desde }, { uid: true });
      const objetivos = (uids || []).filter((uid) => !procesados.has(uid)).slice(0, 100);
      if (objetivos.length === 0) return 0;
      const mensajes = client.fetch(objetivos, { source: true, uid: true }, { uid: true });

      for await (const msg of mensajes) {
        if (!msg.source) continue;

        const mail = await simpleParser(msg.source).catch(() => null);
        if (!mail) continue;

        const partes: string[] = [mail.subject ?? '', mail.text ?? (mail.html ? mail.html.replace(/<[^>]*>/g, ' ') : '')];
        for (const adjunto of mail.attachments) {
          const esPdf = adjunto.contentType === 'application/pdf' || /\.pdf$/i.test(adjunto.filename ?? '');
          if (esPdf) {
            const textoPdf = await textoDePdf(adjunto.content);
            if (textoPdf) partes.push(textoPdf);
          }
        }

        const doc: DocEmail = {
          subject: mail.subject ?? '',
          from: mail.from?.value[0]?.address ?? '',
          body: partes.join('\n'),
        };

        const parseado = parsearFactura(doc);
        if (await registrarEmailProcesado(casilla, msg.uid, parseado)) insertadas += 1;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return insertadas;
}

const PALABRAS_FACTURA =
  /(factura|invoice|boleta|recibo|cuent[a]?\s|vencimien|vence\b|vence\s|due\s?date|payment\s?due|expense|deuda|abono|cuota|pago\s?adelantado)/i;

const PATRON_MONTO =
  /(total|importe|monto|amount|saldo|balance|cuota|abono|deuda)\D{0,20}?(\$?\s?\d{1,9}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s*(u?s?\$?|usd|d[oó]lares|pesos|ars)?/i;

const PATRON_MONTO_MONEDA =
  /(\$\s?\d{1,9}(?:[.,]\d{3})*(?:[.,]\d{2})?|u\$s\s?\d{1,9}(?:[.,]\d{3})*(?:[.,]\d{2})?|usd\s?\d{1,9}(?:[.,]\d{3})*(?:[.,]\d{2})?)/i;

const PATRON_FECHA_ISO_CERCANA =
  /(vencimien\w+|due\s?date|due\s?on|vence|fecha\s?de\s?pago)\D{0,30}?([12]\d{3})-(\d{1,2})-(\d{1,2})/i;

const PATRON_FECHA_DMY_CERCANA =
  /(vencimien\w+|due\s?date|due\s?on|vence|fecha\s?de\s?pago)\D{0,30}?(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/i;

function limpiarMonto(cadena: string): number {
  const sinSimbolo = cadena.replace(/[^\d.,]/g, '');
  if (!sinSimbolo.includes(',') && !sinSimbolo.includes('.')) {
    const entero = Number(sinSimbolo);
    return Number.isNaN(entero) ? 0 : entero;
  }
  const ultimoSeparadorDecimal = Math.max(sinSimbolo.lastIndexOf('.'), sinSimbolo.lastIndexOf(','));
  const parteDecimal = sinSimbolo.slice(ultimoSeparadorDecimal + 1);
  const parteEntera = sinSimbolo.slice(0, ultimoSeparadorDecimal).replace(/[.,]/g, '');
  const numero = parteDecimal.length === 2
    ? Number(`${parteEntera}.${parteDecimal}`)
    : Number(sinSimbolo.replace(/[.,]/g, ''));
  return Number.isNaN(numero) ? 0 : numero;
}

function extraerMonto(texto: string): { monto: number; moneda: Moneda } | null {
  const cercano = texto.match(PATRON_MONTO);
  const bruto: string | undefined = cercano?.[2];
  if (bruto) {
    const referencia = cercano![3] ?? '';
    const indice = texto.indexOf(bruto);
    const contexto = indice >= 0 ? texto.slice(Math.max(0, indice - 8), indice + bruto.length + 8) : '';
    const moneda = /u\$s|usd|d[oó]lares/i.test(`${referencia} ${contexto}`) ? 'USD' : 'ARS';
    return { monto: limpiarMonto(bruto), moneda };
  }
  const simbolo = texto.match(PATRON_MONTO_MONEDA);
  if (simbolo) {
    const moneda = /u\$s|usd/i.test(simbolo[0]) ? 'USD' : 'ARS';
    return { monto: limpiarMonto(simbolo[0]), moneda };
  }
  return null;
}

function normalizarFechaAnioPrimero(anio: string, mes: string, dia: string): string | null {
  const a = Number(anio);
  const m = Number(mes);
  const d = Number(dia);
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const fecha = new Date(a, m - 1, d);
  if (fecha.getDate() !== d || fecha.getMonth() !== m - 1 || fecha.getFullYear() !== a) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normalizarFecha(dia: string, mes: string, anio: string): string | null {
  const d = Number(dia);
  const m = Number(mes);
  let a = Number(anio);
  if (a < 100) a = a < 50 ? 2000 + a : 1900 + a;
  if (d < 1 || d > 31 || m < 1 || m > 12 || a < 2000 || a > 2100) return null;
  const fecha = new Date(a, m - 1, d);
  if (fecha.getDate() !== d || fecha.getMonth() !== m - 1 || fecha.getFullYear() !== a) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extraerFecha(texto: string): string | null {
  const cercanaIso = texto.match(PATRON_FECHA_ISO_CERCANA);
  if (cercanaIso) {
    const normalizada = normalizarFechaAnioPrimero(cercanaIso[2]!, cercanaIso[3]!, cercanaIso[4]!);
    if (normalizada) return normalizada;
  }
  const cercana = texto.match(PATRON_FECHA_DMY_CERCANA);
  if (cercana) {
    const normalizada = normalizarFecha(cercana[2]!, cercana[3]!, cercana[4]!);
    if (normalizada) return normalizada;
  }
  return null;
}

function derivarProveedor(from: string, body: string): string {
  const dominio = from.split('@')[1]?.split('.')[0]?.toLowerCase();
  if (dominio) return dominio.charAt(0).toUpperCase() + dominio.slice(1);
  const enNombre = /de:\s*"?([A-Za-zÁÉÍÓÚÑáéíóúñ 0-9]+)/i.exec(body) ?? null;
  if (enNombre?.[1]) return enNombre[1].trim();
  return 'Proveedor';
}

export function parsearFactura(doc: DocEmail): DatoFacturaEmail | null {
  const texto = `${doc.subject}\n${doc.body}`;

  if (!PALABRAS_FACTURA.test(texto)) return null;

  const montoInfo = extraerMonto(texto);
  if (!montoInfo || montoInfo.monto <= 0) return null;

  const fecha = extraerFecha(texto);
  if (!fecha) return null;

  return {
    proveedor: derivarProveedor(doc.from, texto),
    monto: montoInfo.monto,
    moneda: montoInfo.moneda,
    fecha_vencimiento: fecha,
    email: doc.from,
    notas: `Detectada por email. Asunto: ${doc.subject.slice(0, 200)}`,
  };
}