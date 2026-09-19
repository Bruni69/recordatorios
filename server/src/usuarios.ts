import { pool } from './db.js';
import { hashearContrasena } from './password.js';

export interface Usuario {
  id: number;
  email: string;
  password_hash: string;
  creado_en: string;
}

export async function obtenerUsuarioPorEmail(email: string): Promise<Usuario | null> {
  const { rows } = await pool.query<Usuario>(
    'select id, email, password_hash, creado_en from usuarios where email = $1',
    [email],
  );
  return rows[0] ?? null;
}

export async function crearUsuario(email: string, password: string): Promise<Usuario> {
  const hash = await hashearContrasena(password);
  const { rows } = await pool.query<Usuario>(
    `insert into usuarios (email, password_hash) values ($1, $2)
     returning id, email, password_hash, creado_en`,
    [email, hash],
  );
  return rows[0]!;
}