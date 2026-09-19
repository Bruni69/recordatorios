import pg from 'pg';
import { config } from './config.js';

// Las columnas DATE de PostgreSQL (OID 1082) se devuelven como 'YYYY-MM-DD'
// en vez del objeto Date que traduce pg por defecto.
pg.types.setTypeParser(1082, (valor: string) => valor);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
});

export async function testConexion(): Promise<void> {
  await pool.query('select 1');
}