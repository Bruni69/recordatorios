import type { Factura, NuevaFactura, SettingsPublic, ConfigEmailPublic } from './types';

const TOKEN_KEY = 'rk_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  location.href = '/src/pages/auth/login.html';
}

export function requireAuth(): void {
  if (!getToken()) location.href = '/src/pages/auth/login.html';
}

export class ApiError extends Error {}

async function peticion<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (res.status === 401) {
    logout();
    throw new ApiError('No autorizado');
  }
  if (res.status === 204) return undefined as T;
  const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(cuerpo.error ?? `Error ${res.status}`);
  return cuerpo as T;
}

interface RespuestaAuth {
  token: string;
  email: string;
}

export const api = {
  login(email: string, password: string): Promise<RespuestaAuth> {
    return peticion('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  register(email: string, password: string): Promise<RespuestaAuth> {
    return peticion('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  listarFacturas(): Promise<Factura[]> {
    return peticion('/api/facturas');
  },
  crearFactura(datos: NuevaFactura): Promise<Factura> {
    return peticion('/api/facturas', { method: 'POST', body: JSON.stringify(datos) });
  },
  actualizarFactura(id: number, cambios: Partial<NuevaFactura>): Promise<Factura> {
    return peticion(`/api/facturas/${id}`, { method: 'PATCH', body: JSON.stringify(cambios) });
  },
  eliminarFactura(id: number): Promise<void> {
    return peticion(`/api/facturas/${id}`, { method: 'DELETE' });
  },
  obtenerSettings(): Promise<SettingsPublic> {
    return peticion('/api/settings');
  },
  guardarSettings(whatsapp_to: string): Promise<SettingsPublic> {
    return peticion('/api/settings', { method: 'PUT', body: JSON.stringify({ whatsapp_to }) });
  },
  obtenerConfigEmail(): Promise<ConfigEmailPublic> {
    return peticion('/api/email/config');
  },
  guardarConfigEmail(imap: { host: string; port: number; user: string; password: string }): Promise<{ ok: boolean }> {
    return peticion('/api/email/config', { method: 'POST', body: JSON.stringify(imap) });
  },
  revisarEmail(): Promise<{ insertadas: number }> {
    return peticion('/api/email/check', { method: 'POST' });
  },
  enviarMensajePrueba(): Promise<{ enviado: boolean; motivo: string }> {
    return peticion('/api/notify/test', { method: 'POST' });
  },
  ejecutarRecordatorios(): Promise<{ avisos: number }> {
    return peticion('/api/reminders/run', { method: 'POST' });
  },
};