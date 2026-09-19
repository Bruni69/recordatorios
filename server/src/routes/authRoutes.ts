import { Router, Request, Response } from 'express';
import { emitirToken } from '../auth.js';
import { crearUsuario, obtenerUsuarioPorEmail } from '../usuarios.js';
import { verificarContrasena } from '../password.js';

export const authRoutes = Router();

const MAX_INTENTOS_LOGIN = 8;
const MAX_REGISTROS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const LIMPIEZA_MS = 10 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface VentanaIntento {
  count: number;
  hasta: number;
}

const intentosLoginPorIp = new Map<string, VentanaIntento>();
const registrosPorIp = new Map<string, VentanaIntento>();

function ventanaActiva(v: VentanaIntento, ahora: number): boolean {
  return v.hasta > ahora;
}

function limpiarExpirados(mapa: Map<string, VentanaIntento>, ahora: number): void {
  for (const clave of mapa.keys()) {
    const ventana = mapa.get(clave);
    if (ventana && !ventanaActiva(ventana, ahora)) mapa.delete(clave);
  }
}

function marcarIntento(mapa: Map<string, VentanaIntento>, ip: string): void {
  const ahora = Date.now();
  const previo = mapa.get(ip);
  if (previo && ventanaActiva(previo, ahora)) {
    previo.count += 1;
  } else {
    mapa.set(ip, { count: 1, hasta: ahora + VENTANA_MS });
  }
}

function bloqueado(mapa: Map<string, VentanaIntento>, ip: string, maximo: number): boolean {
  const ventana = mapa.get(ip);
  return ventana !== undefined && ventanaActiva(ventana, Date.now()) && ventana.count >= maximo;
}

const purga = setInterval(() => {
  const ahora = Date.now();
  limpiarExpirados(intentosLoginPorIp, ahora);
  limpiarExpirados(registrosPorIp, ahora);
}, LIMPIEZA_MS);
purga.unref();

function normalizarEmail(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const email = valor.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) return null;
  return email;
}

authRoutes.post('/api/auth/register', async (req: Request, res: Response) => {
  const ip = req.ip ?? 'desconocida';

  if (bloqueado(registrosPorIp, ip, MAX_REGISTROS)) {
    res.status(429).json({ error: 'Demasiados intentos de registro. Probá de nuevo en unos minutos.' });
    return;
  }
  marcarIntento(registrosPorIp, ip);

  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const emailNormalizado = normalizarEmail(email);
  if (!emailNormalizado) {
    res.status(400).json({ error: 'Email inválido' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    return;
  }

  try {
    const yaExiste = await obtenerUsuarioPorEmail(emailNormalizado);
    if (yaExiste) {
      res.status(409).json({ error: 'Ya existe una cuenta con ese email' });
      return;
    }
    const usuario = await crearUsuario(emailNormalizado, password);
    res.status(201).json({ token: emitirToken(usuario.id, usuario.email), email: usuario.email });
  } catch (err) {
    console.error('[auth][register]', err);
    res.status(500).json({ error: 'Error al registrar la cuenta' });
  }
});

authRoutes.post('/api/auth/login', async (req: Request, res: Response) => {
  const ip = req.ip ?? 'desconocida';
  const { email, password } = (req.body ?? {}) as { email?: unknown; password?: unknown };

  if (bloqueado(intentosLoginPorIp, ip, MAX_INTENTOS_LOGIN)) {
    res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' });
    return;
  }
  marcarIntento(intentosLoginPorIp, ip);

  const emailNormalizado = normalizarEmail(email);
  if (!emailNormalizado || typeof password !== 'string' || password === '') {
    res.status(401).json({ error: 'Email o contraseña incorrectos' });
    return;
  }

  try {
    const usuario = await obtenerUsuarioPorEmail(emailNormalizado);
    const contrasenaValida = usuario ? await verificarContrasena(password, usuario.password_hash) : false;
    if (!usuario || !contrasenaValida) {
      res.status(401).json({ error: 'Email o contraseña incorrectos' });
      return;
    }

    intentosLoginPorIp.delete(ip);
    res.json({ token: emitirToken(usuario.id, usuario.email), email: usuario.email });
  } catch (err) {
    console.error('[auth][login]', err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});