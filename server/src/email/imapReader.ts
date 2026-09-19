import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { crearFacturaDeEmail, emailConfiguradoCompletoBd, obtenConfigImap } from '../facturas.js';
import { DatoFacturaEmail, Moneda } from '../models.js';

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

export async function escanearInbox(userId: number): Promise<number> {
  if (!(await emailConfiguradoCompletoBd(userId))) {
    console.log('[email][skip] IMAP no configurado (ni .env ni base de datos)');
    return 0;
  }
  if (escaneosEnCurso.has(userId)) {
    console.log('[email][skip] Escaneo ya en curso para este usuario, se omite.');
    return 0;
  }
  escaneosEnCurso.add(userId);
  try {
    return await escanearCasilla(userId);
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
    secure: true,
    auth: { user: imap.user, pass: imap.password },
    logger: false,
  });

  await client.connect();
  let insertadas = 0;

  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false });
      const objetivos = uids === false ? [] : uids.slice(-30);
      const mensajes = client.fetch(objetivos, { envelope: true, source: true, uid: true });
      const uidsProcesados: number[] = [];

      for await (const msg of mensajes) {
        if (!msg.source) continue;

        const mail = await simpleParser(msg.source).catch(() => null);
        if (!mail) continue;

        const partes: string[] = [mail.subject ?? '', mail.text ?? ''];
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
        if (!parseado) continue;

        await crearFacturaDeEmail(userId, parseado);
        if (msg.uid) uidsProcesados.push(msg.uid);
        insertadas += 1;
        console.log(`[email][factura] Registrada desde ${doc.from} | ${parseado.proveedor} | ${parseado.monto} ${parseado.moneda} | vence ${parseado.fecha_vencimiento}`);
      }

      if (uidsProcesados.length > 0) {
        await client.messageFlagsAdd(uidsProcesados, ['\\Seen']);
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
  const numero = Number(`${parteEntera}.${parteDecimal}`);
  return Number.isNaN(numero) ? 0 : numero;
}

function extraerMonto(texto: string): { monto: number; moneda: Moneda } | null {
  const cercano = texto.match(PATRON_MONTO);
  const bruto: string | undefined = cercano?.[2];
  if (bruto) {
    const referencia = cercano![3] ?? '';
    const indice = texto.indexOf(bruto);
    const contexto = indice >= 0 ? texto.slice(indice + bruto.length, indice + bruto.length + 8) : '';
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