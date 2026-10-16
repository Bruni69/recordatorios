import { pool } from '../db.js';
import { crearFacturaDeEmail } from '../facturas.js';
import type { DatoFacturaEmail } from '../models.js';

export interface IdentidadCasilla {
  userId: number;
  casilla: string;
  uidValidity: string;
}

export async function obtenerUidsProcesados(casilla: IdentidadCasilla): Promise<Set<number>> {
  const { rows } = await pool.query<{ uid: string }>(
    'select uid from emails_procesados where user_id = $1 and casilla = $2 and uid_validity = $3',
    [casilla.userId, casilla.casilla, casilla.uidValidity],
  );
  return new Set(rows.map((row) => Number(row.uid)));
}

// Reservar UID e insertar la factura en la misma transacción evita duplicados,
// incluso si dos instancias escanean la misma casilla simultáneamente.
export async function registrarEmailProcesado(casilla: IdentidadCasilla, uid: number, factura: DatoFacturaEmail | null): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `insert into emails_procesados (user_id, casilla, uid_validity, uid)
       values ($1, $2, $3, $4) on conflict do nothing`,
      [casilla.userId, casilla.casilla, casilla.uidValidity, uid],
    );
    if (rowCount && factura) await crearFacturaDeEmail(casilla.userId, factura, client);
    await client.query('COMMIT');
    return Boolean(rowCount && factura);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
