import bcrypt from 'bcryptjs';

const COSTO_SALT = 10;

export function hashearContrasena(password: string): Promise<string> {
  return bcrypt.hash(password, COSTO_SALT);
}

export function verificarContrasena(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}