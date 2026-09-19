-- Schema para Supabase: ejecutar en SQL Editor de tu proyecto (solo instalaciones nuevas).
-- Recordatorios de impuestos y deudas (multi-usuario)
-- El servidor crea el usuario administrador en el primer arranque (ver asegurarMigracion en server/src/migracion.ts).

create table if not exists usuarios (
  id            bigserial primary key,
  email         text unique not null,
  password_hash text not null,
  creado_en     timestamptz not null default now()
);

create table if not exists facturas (
  id                     bigserial primary key,
  user_id                bigint not null references usuarios(id) on delete cascade,
  proveedor              text not null,
  monto                  numeric(14,2) not null default 0,
  moneda                 text not null default 'ARS',
  fecha_vencimiento      date not null,
  estado                 text not null default 'pendiente',
  origen                 text not null default 'manual',
  email                  text,
  notas                  text,
  aviso_semana_enviado   boolean not null default false,
  aviso_48hs_enviado     boolean not null default false,
  creada_en              timestamptz not null default now()
);

create index if not exists idx_facturas_vencimiento on facturas (fecha_vencimiento);
create index if not exists idx_facturas_estado on facturas (estado);
create index if not exists idx_facturas_usuario on facturas (user_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_facturas_estado') then
    alter table facturas add constraint chk_facturas_estado check (estado in ('pendiente', 'pagada', 'revisar'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_facturas_moneda') then
    alter table facturas add constraint chk_facturas_moneda check (moneda in ('ARS', 'USD', 'OTRA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_facturas_origen') then
    alter table facturas add constraint chk_facturas_origen check (origen in ('email', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_facturas_monto_positivo') then
    alter table facturas add constraint chk_facturas_monto_positivo check (monto >= 0);
  end if;
end $$;

create table if not exists settings (
  user_id bigint not null references usuarios(id) on delete cascade,
  key     text not null,
  value   text,
  primary key (user_id, key)
);