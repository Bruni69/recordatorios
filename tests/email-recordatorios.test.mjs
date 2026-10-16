import assert from 'node:assert/strict';
import { test, before, after, beforeEach, afterEach, mock } from 'node:test';
import pg from 'pg';
import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import cron from 'node-cron';

if (!process.env.TEST_DATABASE_URL) throw new Error('Indicá TEST_DATABASE_URL para una base PostgreSQL de pruebas.');
const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const schema = `test_email_${process.pid}`;
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('options', `-c search_path=${schema}`);
process.env.DATABASE_URL = url.toString();
process.env.APP_PASSWORD = 'test-only-admin-password';
process.env.JWT_SECRET = 'test-only-secret-not-for-production';
const { pool } = await import('../server/src/db.ts');
const { config } = await import('../server/src/config.ts');
const { asegurarMigracion } = await import('../server/src/migracion.ts');
const { parsearFactura, escanearInbox } = await import('../server/src/email/imapReader.ts');
const { registrarEmailProcesado } = await import('../server/src/email/procesados.ts');
const { revisarVencimientos, diasHasta, iniciarScheduler } = await import('../server/src/reminders/scheduler.ts');
const { escanearCasillasConfiguradas } = await import('../server/src/email/scheduler.ts');
const { emailAvisosConfigurado, enviarEmailAviso } = await import('../server/src/notify/emailNotify.ts');
let userId;
const factura = { proveedor: 'Proveedor', monto: 1234, moneda: 'ARS', fecha_vencimiento: '2099-12-20', email: 'facturacion@example.com', notas: 'Prueba' };
const identidad = () => ({ userId, casilla: 'test', uidValidity: '777' });

before(async () => {
  await admin.query(`create schema ${schema}`);
  await asegurarMigracion();
  // Ejercitar también la repetición de la migración sobre un esquema existente.
  await asegurarMigracion();
});
beforeEach(async () => {
  mock.restoreAll();
  config.smtp.user = ''; config.smtp.password = '';
  config.imap.host = ''; config.imap.user = ''; config.imap.password = '';
  await pool.query('truncate usuarios cascade');
  const { rows } = await pool.query("insert into usuarios(email,password_hash) values ('test@example.com','unused') returning id");
  userId = rows[0].id;
});
afterEach(() => mock.restoreAll());
after(async () => {
  await pool.end();
  await admin.query(`drop schema ${schema} cascade`);
  await admin.end();
});

async function configurarGmail(id = userId) {
  for (const [key, value] of Object.entries({imap_host:'imap.gmail.com',imap_user:'test@gmail.com',imap_password:'test-only-app-password',imap_port:'993'})) {
    await pool.query('insert into settings(user_id,key,value) values ($1,$2,$3) on conflict(user_id,key) do update set value=excluded.value', [id,key,value]);
  }
}
function correo(uid, body = 'Total: $ 1.234,56\nVence: 2099-12-20') {
  return { uid, source: Buffer.from(`From: facturacion@example.com\r\nSubject: Factura\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`) };
}
function imapFalso(messages) {
  const requests = [];
  mock.method(ImapFlow.prototype, 'connect', async function() {});
  mock.method(ImapFlow.prototype, 'getMailboxLock', async function() { this.mailbox = { uidValidity: 777n }; return {release(){}}; });
  mock.method(ImapFlow.prototype, 'search', async (query, options) => { assert.ok(query.since instanceof Date); assert.equal(query.seen, undefined); assert.equal(options.uid,true); return messages.map(m=>m.uid); });
  mock.method(ImapFlow.prototype, 'fetch', async function* (uids, query, options) { assert.equal(options.uid,true); requests.push(uids); for(const msg of messages) if(uids.includes(msg.uid)) yield msg; });
  mock.method(ImapFlow.prototype, 'messageFlagsAdd', async () => { throw new Error('No debe alterar el estado de lectura de la casilla'); });
  mock.method(ImapFlow.prototype, 'logout', async () => {});
  return requests;
}
function smtpFalso(fallar = false) {
  const enviados = [], opciones = [];
  mock.method(nodemailer, 'createTransport', (opts) => { opciones.push(opts);return {sendMail:async (mail)=>{if(fallar) throw new Error('SMTP inaccesible');enviados.push(mail);},close(){}}; });
  return {enviados, opciones};
}

test('parser: miles, decimales, USD y fechas inválidas', () => {
  for(const [importe, monto, moneda] of [['$ 1.234',1234,'ARS'],['$ 1.234.567',1234567,'ARS'],['$ 1.234,56',1234.56,'ARS'],['USD 100.00',100,'USD'],['U$S 100,00',100,'USD']]) {
    const result=parsearFactura({subject:'Factura',from:'facturas@example.com',body:`Total: ${importe}\nVence: 2026-12-20`});
    assert.equal(result?.monto,monto,importe);assert.equal(result?.moneda,moneda,importe);
  }
  assert.equal(parsearFactura({subject:'Factura',from:'a@example.com',body:'Total: $ 100\nVence: 31/02/2026'}),null);
});

test('importación atómica: escaneos simultáneos no duplican y un fallo permite reintentar', async () => {
  const results=await Promise.all([registrarEmailProcesado(identidad(),80,factura),registrarEmailProcesado(identidad(),80,factura)]);
  assert.equal(results.filter(Boolean).length,1);
  await assert.rejects(registrarEmailProcesado(identidad(),81,{...factura,monto:-1}));
  assert.equal(await registrarEmailProcesado(identidad(),81,factura),true);
  assert.equal((await pool.query('select * from facturas')).rowCount,2);
});

test('escaneo: incluye mensajes leídos, persiste facturas y omite UID procesados al repetir', async () => {
  await configurarGmail();
  const requests=imapFalso([correo(120),correo(200,'Hola, no es una factura')]);
  assert.equal((await escanearInbox(userId)).insertadas,1);
  assert.equal((await escanearInbox(userId)).insertadas,0);
  assert.deepEqual(requests,[[120,200]]);
  const {rows}=await pool.query('select * from facturas');
  assert.equal(rows[0].origen,'email');assert.equal(rows[0].estado,'revisar');
  assert.equal(Number(rows[0].monto),1234.56);
});

test('escaneo: casilla vacía no invoca fetch con una lista vacía', async () => {
  await configurarGmail();const requests=imapFalso([]);
  assert.equal((await escanearInbox(userId)).insertadas,0);assert.deepEqual(requests,[]);
});

test('escaneo automático: procesa las cuentas configuradas y programa ambos trabajos', async () => {
  await configurarGmail();imapFalso([correo(888)]);
  await escanearCasillasConfiguradas();
  assert.equal((await pool.query('select * from facturas')).rowCount,1);
  const trabajos=[];
  mock.method(cron,'schedule',(expression, fn, options)=>{trabajos.push({expression,fn,options});return {};});
  iniciarScheduler();assert.equal(trabajos.length,2);
  assert.equal(trabajos[0].options.timezone,config.timezone);
  await trabajos[0].fn();
  assert.equal((await pool.query('select * from facturas')).rowCount,1);
});

test('SMTP: Gmail configurado habilita envío con TLS y remitente; sin credenciales no envía', async () => {
  assert.equal(await emailAvisosConfigurado(userId),false);
  assert.equal((await enviarEmailAviso('test@example.com','test','test',userId)).enviado,false);
  await configurarGmail();const fake=smtpFalso();
  assert.equal(await emailAvisosConfigurado(userId),true);
  assert.equal((await enviarEmailAviso('test@example.com','test','test',userId)).enviado,true);
  assert.equal(fake.opciones[0].secure,true);assert.equal(fake.opciones[0].port,465);
  assert.equal(fake.enviados[0].from,'test@gmail.com');
});

test('avisos: 72 y 48 horas, estado revisar incluido, aislamiento y sin duplicados al repetir', async () => {
  await configurarGmail();const fake=smtpFalso();
  for(const [days,estado] of [[3,'revisar'],[2,'pendiente'],[7,'pendiente'],[3,'pagada'],[-1,'pendiente']]) {
    await pool.query(`insert into facturas(user_id,proveedor,monto,fecha_vencimiento,estado) values ($1,'test',100,(now() at time zone $2)::date + $3::int,$4)`,[userId,config.timezone,days,estado]);
  }
  const other=(await pool.query("insert into usuarios(email,password_hash) values ('other@example.com','unused') returning id")).rows[0].id;
  await pool.query("insert into facturas(user_id,proveedor,monto,fecha_vencimiento) values ($1,'otro',100,(now() at time zone $2)::date + 3)",[other,config.timezone]);
  const results=await Promise.all([revisarVencimientos(userId),revisarVencimientos(userId)]);
  assert.equal(results.reduce((a,b)=>a+b,0),2);assert.equal(fake.enviados.length,2);
  assert.ok(fake.enviados.some(m=>m.subject.includes('72 horas')));
  assert.ok(fake.enviados.some(m=>m.text.includes('48 horas')));
  assert.ok(fake.enviados.every(m=>m.to==='test@example.com'));
  assert.equal(await revisarVencimientos(userId),0);
  const today=(await pool.query('select (now() at time zone $1)::date as hoy',[config.timezone])).rows[0].hoy;
  assert.equal(diasHasta(today),0);
});

test('avisos: envío fallido libera el aviso y permite reintentar', async () => {
  await configurarGmail();
  await pool.query("insert into facturas(user_id,proveedor,monto,fecha_vencimiento) values ($1,'test',100,(now() at time zone $2)::date + 2)",[userId,config.timezone]);
  smtpFalso(true);await assert.rejects(revisarVencimientos(userId), /No se pudieron enviar/);
  assert.equal((await pool.query('select aviso_48hs_enviado from facturas')).rows[0].aviso_48hs_enviado,false);
  mock.restoreAll();const fake=smtpFalso();assert.equal(await revisarVencimientos(userId),1);assert.equal(fake.enviados.length,1);
});


test('migración: preserva facturas y settings antiguos sin user_id y agrega el aviso de 72h', async () => {
  const client = await pool.connect();
  const original = pool.query;
  pool.query = client.query.bind(client);
  try {
    await client.query('begin');
    await client.query(`create schema ${schema}_legacy`);
    await client.query(`set local search_path to ${schema}_legacy`);
    const sql = fs.readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8');
    const legacy = sql.match(/create table if not exists facturas \([\s\S]*?\n\);/)[0]
      .replace(/^.*user_id.*\n/m, '').replace(/^.*aviso_72hs_enviado.*\n/m, '');
    await client.query(legacy);
    await client.query("insert into facturas(proveedor,fecha_vencimiento) values ('Anterior','2099-12-20')");
    await client.query('create table settings (key text primary key, value text)');
    await client.query("insert into settings values ('whatsapp_to','test-only')");
    await asegurarMigracion();
    await asegurarMigracion();
    const row=(await client.query('select * from facturas')).rows[0];
    assert.ok(row.user_id);assert.equal(row.aviso_72hs_enviado,false);
    assert.equal(row.proveedor,'Anterior');
    assert.ok((await client.query('select user_id from settings')).rows[0].user_id);
  } finally {
    await client.query('rollback');pool.query=original;client.release();
  }
});

test('escaneo: los lotes avanzan más allá de 100 mensajes sin perder facturas', async () => {
  await configurarGmail();
  const messages=Array.from({length:101},(_,i)=>correo(i+1,i===100?'Total: $ 500\nVence: 2099-12-20':'Un saludo'));
  const requests=imapFalso(messages);
  assert.equal((await escanearInbox(userId)).insertadas,0);
  assert.equal((await escanearInbox(userId)).insertadas,1);
  assert.equal(requests[0].length,100);assert.deepEqual(requests[1],[101]);
});

test('escaneo: fallo de conexión no bloquea el próximo intento', async () => {
  await configurarGmail();
  mock.method(ImapFlow.prototype,'connect',async ()=>{throw new Error('Autenticación rechazada');});
  await assert.rejects(escanearInbox(userId),/Autenticación rechazada/);
  mock.restoreAll();imapFalso([correo(99)]);
  assert.equal((await escanearInbox(userId)).insertadas,1);
});
