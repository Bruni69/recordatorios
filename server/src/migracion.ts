import crypto from 'node:crypto';
import { pool } from './db.js';
import { config } from './config.js';
import { hashearContrasena } from './password.js';

async function tablaExiste(nombre: string): Promise<boolean> {
  const { rows } = await pool.query<{ existe: boolean }>(
    'select to_regclass($1) is not null as existe',
    [nombre],
  );
  return rows[0]!.existe;
}

async function columnaExiste(tabla: string, columna: string): Promise<boolean> {
  const { rows } = await pool.query(
    "select 1 from information_schema.columns where table_name = $1 and column_name = $2",
    [tabla, columna],
  );
  return rows.length > 0;
}

async function asegurarTablaUsuarios(): Promise<number> {
  await pool.query(`create table if not exists usuarios (
    id           bigserial primary key,
    email        text unique not null,
    password_hash text not null,
    creado_en    timestamptz not null default now()
  )`);

  const { rows: existente } = await pool.query<{ id: number }>(
    'select id from usuarios where email = $1',
    [config.adminEmail],
  );
  if (existente[0]) return existente[0].id;

  let password: string;
  if (config.appPassword && config.appPassword.length >= 8) {
    password = config.appPassword;
  } else {
    password = crypto.randomBytes(12).toString('base64url');
    console.log(`[migracion] Se creó el usuario administrador (${config.adminEmail}). Contraseña temporal: ${password}`);
    console.log(`[migracion] Usá esta contraseña para iniciar sesión. Guardala en un lugar seguro.`);
  }

  const hash = await hashearContrasena(password);
  const { rows } = await pool.query<{ id: number }>(
    'insert into usuarios (email, password_hash) values ($1, $2) returning id',
    [config.adminEmail, hash],
  );
  return rows[0]!.id;
}

async function asegurarFacturas(adminId: number): Promise<void> {
  if (!(await tablaExiste('facturas'))) return;

  if (!(await columnaExiste('facturas', 'user_id'))) {
    await pool.query('alter table facturas add column user_id bigint references usuarios(id) on delete cascade');
  }

  await pool.query('update facturas set user_id = $1 where user_id is null', [adminId]);
  await pool.query('alter table facturas alter column user_id set not null');
  await pool.query('create index if not exists idx_facturas_usuario on facturas (user_id)');
}

async function asegurarSettings(adminId: number): Promise<void> {
  if (!(await tablaExiste('settings'))) return;

  if (!(await columnaExiste('settings', 'user_id'))) {
    await pool.query('alter table settings add column user_id bigint references usuarios(id) on delete cascade');
  }

  await pool.query('update settings set user_id = $1 where user_id is null', [adminId]);
  await pool.query('alter table settings alter column user_id set not null');
  await pool.query('alter table settings drop constraint if exists settings_pkey');
  await pool.query('alter table settings add primary key (user_id, key)');
}

export async function asegurarMigracion(): Promise<void> {
  const adminId = await asegurarTablaUsuarios();
  await asegurarFacturas(adminId);
  await asegurarSettings(adminId);
  console.log('✅ Migración de esquema verificada/aplicada.');
}