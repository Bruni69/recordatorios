/// <reference types="node" />
import { pool } from './db.js';
import { Factura, FilaFactura, filaAFactura, NuevaFactura, DatoFacturaEmail, SettingsPublic } from './models.js';
import { config } from './config.js';

export async function listarFacturas(userId: number, estado?: string): Promise<Factura[]> {
  if (estado) {
    const { rows } = await pool.query<FilaFactura>(
      'select * from facturas where user_id = $1 and estado = $2 order by fecha_vencimiento asc, id desc',
      [userId, estado],
    );
    return rows.map(filaAFactura);
  }
  const { rows } = await pool.query<FilaFactura>(
    'select * from facturas where user_id = $1 order by fecha_vencimiento asc, id desc',
    [userId],
  );
  return rows.map(filaAFactura);
}

export async function crearFactura(userId: number, datos: NuevaFactura, origen: 'email' | 'manual'): Promise<Factura> {
  const { proveedor, monto, moneda, fecha_vencimiento, notas, estado } = datos;
  const { rows } = await pool.query<FilaFactura>(
    `insert into facturas (user_id, proveedor, monto, moneda, fecha_vencimiento, notas, origen, estado, email)
     values ($1, $2, $3, $4, $5, $6, $7, $8, null)
     returning *`,
    [userId, proveedor, monto, moneda, fecha_vencimiento, notas ?? null, origen, estado ?? 'pendiente'],
  );
  return filaAFactura(rows[0]!);
}

export async function crearFacturaDeEmail(userId: number, datos: DatoFacturaEmail): Promise<Factura> {
  const { proveedor, monto, moneda, fecha_vencimiento, email, notas } = datos;
  const { rows } = await pool.query<FilaFactura>(
    `insert into facturas (user_id, proveedor, monto, moneda, fecha_vencimiento, email, notas, origen, estado)
     values ($1, $2, $3, $4, $5, $6, $7, 'email', 'revisar')
     returning *`,
    [userId, proveedor, monto, moneda, fecha_vencimiento, email, notas],
  );
  return filaAFactura(rows[0]!);
}

export async function actualizarFactura(
  userId: number,
  id: number,
  cambios: Partial<Pick<NuevaFactura, 'proveedor' | 'monto' | 'moneda' | 'fecha_vencimiento' | 'notas' | 'estado'>>
): Promise<Factura | null> {
  const fila = await buscarFactura(userId, id);
  if (!fila) return null;

  const proveedor = cambios.proveedor ?? fila.proveedor;
  const monto = cambios.monto ?? fila.monto;
  const moneda = cambios.moneda ?? fila.moneda;
  const fecha_vencimiento = cambios.fecha_vencimiento ?? fila.fecha_vencimiento;
  const notas = cambios.notas !== undefined ? cambios.notas : fila.notas;
  const estado = cambios.estado ?? fila.estado;

  // Si cambia la fecha de vencimiento se resetean los avisos ya enviados.
  const resetAvisos = cambios.fecha_vencimiento !== undefined && cambios.fecha_vencimiento !== fila.fecha_vencimiento;

  const { rows } = await pool.query<FilaFactura>(
    `update facturas
     set proveedor = $1, monto = $2, moneda = $3, fecha_vencimiento = $4,
         notas = $5, estado = $6,
         aviso_semana_enviado = case when $7 then false else aviso_semana_enviado end,
         aviso_48hs_enviado = case when $7 then false else aviso_48hs_enviado end
     where id = $8 and user_id = $9
     returning *`,
    [proveedor, monto, moneda, fecha_vencimiento, notas, estado, resetAvisos, id, userId],
  );
  return filaAFactura(rows[0]!);
}

export async function eliminarFactura(userId: number, id: number): Promise<boolean> {
  const { rowCount } = await pool.query('delete from facturas where id = $1 and user_id = $2', [id, userId]);
  return (rowCount ?? 0) > 0;
}

export async function buscarFactura(userId: number, id: number): Promise<Factura | null> {
  const { rows } = await pool.query<FilaFactura>(
    'select * from facturas where id = $1 and user_id = $2',
    [id, userId],
  );
  if (rows.length === 0) return null;
  return filaAFactura(rows[0]!);
}

export type ColumnaAviso = 'aviso_semana_enviado' | 'aviso_48hs_enviado';

export async function marcarAvisoEnviado(userId: number, id: number, columna: ColumnaAviso): Promise<void> {
  await pool.query(`update facturas set ${columna} = true where id = $1 and user_id = $2`, [id, userId]);
}

export async function reclamarAviso(userId: number, id: number, columna: ColumnaAviso): Promise<boolean> {
  const { rowCount } = await pool.query(
    `update facturas set ${columna} = true where id = $1 and user_id = $2 and ${columna} = false`,
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}

export async function liberarAviso(userId: number, id: number, columna: ColumnaAviso): Promise<void> {
  await pool.query(`update facturas set ${columna} = false where id = $1 and user_id = $2`, [id, userId]);
}

export async function marcarAvisosEnviados(userId: number, ids: number[], columna: ColumnaAviso): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `update facturas set ${columna} = true where id = any($1::bigint[]) and user_id = $2`,
    [ids, userId],
  );
}

export interface FacturaConDueno extends Factura {
  user_id: number;
}

export async function facturasPendientesProximas(diasRestantes: number[]): Promise<FacturaConDueno[]> {
  const { rows } = await pool.query<FilaFactura>(
    `select * from facturas
     where estado in ('pendiente', 'revisar')
       and fecha_vencimiento in (
         select (current_date + generado.d)::date
         from generate_series(0, 365) generado(d)
         where generado.d = any($1::int[])
       )
     order by fecha_vencimiento asc`,
    [diasRestantes],
  );
  console.log('[debug][facturasPendientesProximas] rows:', rows.length, JSON.stringify(rows));
  return rows.map((fila) => ({ ...filaAFactura(fila), user_id: fila.user_id }));
}

export async function obtenerSetting(userId: number, clave: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string }>(
    'select value from settings where user_id = $1 and key = $2',
    [userId, clave],
  );
  return rows[0]?.value ?? null;
}

export async function guardarSetting(userId: number, clave: string, valor: string): Promise<void> {
  await pool.query(
    `insert into settings (user_id, key, value) values ($1, $2, $3)
     on conflict (user_id, key) do update set value = excluded.value`,
    [userId, clave, valor],
  );
}

export async function whatsappsDeUsuarios(userIds: number[]): Promise<Map<number, string>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await pool.query<{ user_id: number; value: string | null }>(
    `select user_id, value from settings where key = 'whatsapp_to' and user_id = any($1::bigint[])`,
    [userIds],
  );
  const resultado = new Map<number, string>();
  for (const fila of rows) {
    const valor = fila.value?.trim() ?? '';
    if (valor !== '') resultado.set(fila.user_id, valor);
  }
  return resultado;
}
export async function emailsDeUsuarios(userIds: number[]): Promise<Map<number, string>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await pool.query<{ id: number; email: string }>(
    `select id, email from usuarios where id = any($1::bigint[])`,
    [userIds],
  );
  const resultado = new Map<number, string>();
  for (const fila of rows) {
    if (fila.email?.trim()) resultado.set(fila.id, fila.email.trim());
  }
  return resultado;
}

export interface ConfigImapBd {
  host: string;
  port: number;
  user: string;
  password: string;
}

export async function obtenerSettingsPublicos(userId: number): Promise<SettingsPublic> {
  const whatsappTo = await obtenerSetting(userId, 'whatsapp_to');
  const imap = await obtenConfigImap(userId);
  return {
    whatsapp_to: whatsappTo ?? '',
    email_configurado: imap !== null,
  };
}

export async function obtenerConfigImapDesdeBd(userId: number): Promise<ConfigImapBd | null> {
  const host = await obtenerSetting(userId, 'imap_host');
  const user = await obtenerSetting(userId, 'imap_user');
  const password = await obtenerSetting(userId, 'imap_password');
  if (!host || !user || !password) return null;
  const port = Number((await obtenerSetting(userId, 'imap_port')) ?? config.imap.port);
  return { host, port: Number.isInteger(port) && port > 0 ? port : config.imap.port, user, password };
}

export async function obtenConfigImap(userId: number): Promise<ConfigImapBd | null> {
  const desdeBd = await obtenerConfigImapDesdeBd(userId);
  if (desdeBd) return desdeBd;
  if (!config.imap.host || !config.imap.user || !config.imap.password) return null;
  return { host: config.imap.host, port: config.imap.port, user: config.imap.user, password: config.imap.password };
}

export async function emailConfiguradoCompletoBd(userId: number): Promise<boolean> {
  return (await obtenConfigImap(userId)) !== null;
}