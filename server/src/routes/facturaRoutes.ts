import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth.js';
import { listarFacturas, crearFactura, actualizarFactura, eliminarFactura } from '../facturas.js';
import { Moneda, NuevaFactura } from '../models.js';

export const facturaRoutes = Router();

facturaRoutes.use('/api/facturas', requireAuth);

const ESTADOS_VALIDOS = new Set(['pendiente', 'pagada', 'revisar']);

function esFechaValida(fecha: unknown): fecha is string {
  if (typeof fecha !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const dt = new Date(anio!, mes! - 1, dia!);
  return dt.getFullYear() === anio && dt.getMonth() === mes! - 1 && dt.getDate() === dia;
}

function esMonedaValida(m: unknown): m is Moneda {
  return m === 'ARS' || m === 'USD' || m === 'OTRA';
}

function validarNuevaFactura(body: unknown): NuevaFactura | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.proveedor !== 'string' || b.proveedor.trim() === '') return null;
  if (typeof b.monto !== 'number' || Number.isNaN(b.monto) || b.monto < 0) return null;
  if (!esMonedaValida(b.moneda)) return null;
  if (!esFechaValida(b.fecha_vencimiento)) return null;
  if (b.notas !== undefined && typeof b.notas !== 'string') return null;
  if (b.estado !== undefined && b.estado !== 'pendiente' && b.estado !== 'revisar') return null;

  return {
    proveedor: b.proveedor.trim(),
    monto: b.monto,
    moneda: b.moneda,
    fecha_vencimiento: b.fecha_vencimiento,
    notas: typeof b.notas === 'string' ? b.notas : null,
    estado: b.estado === 'revisar' ? 'revisar' : 'pendiente',
  };
}

facturaRoutes.get('/api/facturas', async (req: Request, res: Response) => {
  try {
    const estado = typeof req.query.estado === 'string' ? req.query.estado : undefined;
    if (estado !== undefined && !ESTADOS_VALIDOS.has(estado)) {
      res.status(400).json({ error: `estado inválido: ${estado}` });
      return;
    }
    const facturas = await listarFacturas(req.usuarioId, estado);
    res.json(facturas);
  } catch (err) {
    console.error('[facturas][listar]', err);
    res.status(500).json({ error: 'Error al listar facturas' });
  }
});

facturaRoutes.post('/api/facturas', async (req: Request, res: Response) => {
  const datos = validarNuevaFactura(req.body);
  if (!datos) {
    res.status(400).json({ error: 'Datos inválidos: proveedor, monto, moneda y fecha_vencimiento son obligatorios' });
    return;
  }
  try {
    const factura = await crearFactura(req.usuarioId, datos, 'manual');
    res.status(201).json(factura);
  } catch (err) {
    console.error('[facturas][crear]', err);
    res.status(500).json({ error: 'Error al crear factura' });
  }
});

facturaRoutes.patch('/api/facturas/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Id inválido' });
    return;
  }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const cambios: Partial<NuevaFactura> = {};

  if (b.proveedor !== undefined) {
    if (typeof b.proveedor !== 'string' || b.proveedor.trim() === '') {
      res.status(400).json({ error: 'proveedor inválido' });
      return;
    }
    cambios.proveedor = b.proveedor.trim();
  }
  if (b.monto !== undefined) {
    if (typeof b.monto !== 'number' || Number.isNaN(b.monto) || b.monto < 0) {
      res.status(400).json({ error: 'monto inválido' });
      return;
    }
    cambios.monto = b.monto;
  }
  if (b.moneda !== undefined) {
    if (!esMonedaValida(b.moneda)) {
      res.status(400).json({ error: 'moneda inválida' });
      return;
    }
    cambios.moneda = b.moneda;
  }
  if (b.fecha_vencimiento !== undefined) {
    if (!esFechaValida(b.fecha_vencimiento)) {
      res.status(400).json({ error: 'fecha_vencimiento inválida' });
      return;
    }
    cambios.fecha_vencimiento = b.fecha_vencimiento;
  }
  if (b.notas !== undefined) {
    if (b.notas !== null && typeof b.notas !== 'string') {
      res.status(400).json({ error: 'notas inválidas' });
      return;
    }
    cambios.notas = b.notas as string | null;
  }
  if (b.estado !== undefined) {
    if (b.estado !== 'pendiente' && b.estado !== 'pagada' && b.estado !== 'revisar') {
      res.status(400).json({ error: 'estado inválido' });
      return;
    }
    cambios.estado = b.estado;
  }

  try {
    const factura = await actualizarFactura(req.usuarioId, id, cambios);
    if (!factura) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }
    res.json(factura);
  } catch (err) {
    console.error('[facturas][actualizar]', err);
    res.status(500).json({ error: 'Error al actualizar factura' });
  }
});

facturaRoutes.delete('/api/facturas/:id', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Id inválido' });
    return;
  }
  try {
    const borrado = await eliminarFactura(req.usuarioId, id);
    if (!borrado) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    console.error('[facturas][eliminar]', err);
    res.status(500).json({ error: 'Error al eliminar factura' });
  }
});