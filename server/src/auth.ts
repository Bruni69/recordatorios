import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

declare global {
  namespace Express {
    interface Request {
      usuarioId: number;
      usuarioEmail: string;
    }
  }
}

export interface TokenPayload {
  sub: string;
  email?: string;
}

export function emitirToken(userId: number, email: string): string {
  return jwt.sign({ sub: String(userId), email }, config.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as TokenPayload;
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(401).json({ error: 'Token invalido' });
      return;
    }
    req.usuarioId = id;
    req.usuarioEmail = payload.email ?? '';
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido o expirado' });
  }
}