import { pool } from '../db.js';
import { config } from '../config.js';
import { escanearInbox } from './imapReader.js';

let escaneando = false;

export async function escanearCasillasConfiguradas(): Promise<void> {
  if (escaneando) return;
  escaneando = true;
  try {
    const { rows } = await pool.query<{ user_id: number }>(
      `select user_id from settings
       where key in ('imap_host', 'imap_user', 'imap_password') and coalesce(value, '') <> ''
       group by user_id having count(distinct key) = 3`,
    );
    const usuarios = new Set(rows.map((r) => r.user_id));
    // La casilla global pertenece al administrador, no a cada cuenta registrada.
    if (config.imap.host && config.imap.user && config.imap.password) {
      const admin = await pool.query<{ id: number }>('select id from usuarios where email = $1', [config.adminEmail]);
      if (admin.rows[0]) usuarios.add(admin.rows[0].id);
    }
    for (const userId of usuarios) {
      try {
        const resultado = await escanearInbox(userId);
        if (resultado.insertadas > 0) console.log(`[email] ${resultado.insertadas} factura(s) importada(s).`);
      } catch (err) {
        // Una casilla inaccesible no debe detener las demás ni los recordatorios.
        console.error(`[email] No se pudo escanear la casilla del usuario ${userId}:`, err instanceof Error ? err.message : 'Error de conexión');
      }
    }
  } finally {
    escaneando = false;
  }
}
