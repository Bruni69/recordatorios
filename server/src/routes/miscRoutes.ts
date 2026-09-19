import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../auth.js';
import { escanearInbox } from '../email/imapReader.js';
import {
  emailConfiguradoCompletoBd,
  guardarSetting,
  obtenerConfigImapDesdeBd,
  obtenerSettingsPublicos,
} from '../facturas.js';
import { enviarWhatsAppConfigurado } from '../notify/whatsapp.js';
import { revisarVencimientos } from '../reminders/scheduler.js';

export const miscRoutes = Router();

miscRoutes.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true });
  } catch (err) {
    console.error('[health]', err);
    res.status(503).json({ ok: false });
  }
});

miscRoutes.get('/api/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await obtenerSettingsPublicos(req.usuarioId));
  } catch (err) {
    console.error('[settings][get]', err);
    res.status(500).json({ error: 'Error al cargar la configuración' });
  }
});

miscRoutes.put('/api/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const { whatsapp_to } = req.body ?? {};
    if (typeof whatsapp_to !== 'string') {
      res.status(400).json({ error: 'El número de celular es obligatorio' });
      return;
    }
    await guardarSetting(req.usuarioId, 'whatsapp_to', whatsapp_to.trim());
    res.json(await obtenerSettingsPublicos(req.usuarioId));
  } catch (err) {
    console.error('[settings][put]', err);
    res.status(500).json({ error: 'Error al guardar la configuración' });
  }
});

miscRoutes.get('/api/email/config', requireAuth, async (req: Request, res: Response) => {
  try {
    const guardada = await obtenerConfigImapDesdeBd(req.usuarioId);
    res.json({
      configurado: await emailConfiguradoCompletoBd(req.usuarioId),
      host: guardada?.host ?? '',
      port: guardada?.port ?? null,
      user: guardada?.user ?? '',
    });
  } catch (err) {
    console.error('[email][config][get]', err);
    res.status(500).json({ error: 'Error al leer la configuración de email' });
  }
});

miscRoutes.post('/api/email/config', requireAuth, async (req: Request, res: Response) => {
  try {
    const { host, user, password, port } = req.body ?? {};
    if (
      typeof host !== 'string' ||
      host.trim() === '' ||
      typeof user !== 'string' ||
      user.trim() === '' ||
      typeof password !== 'string' ||
      password.trim() === ''
    ) {
      res.status(400).json({ error: 'Host, usuario y contraseña son obligatorios' });
      return;
    }
    await guardarSetting(req.usuarioId, 'imap_host', host.trim());
    await guardarSetting(req.usuarioId, 'imap_user', user.trim());
    await guardarSetting(req.usuarioId, 'imap_password', password.trim());
    if (typeof port === 'number' && port > 0) {
      await guardarSetting(req.usuarioId, 'imap_port', String(port));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[email][config][post]', err);
    res.status(500).json({ error: 'Error al guardar la configuración de email' });
  }
});

miscRoutes.post('/api/email/check', requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await escanearInbox(req.usuarioId));
  } catch (err) {
    console.error('[email][check]', err);
    const detalle = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: `No se pudo conectar o autenticar con el servidor IMAP: ${detalle.slice(0, 300)}`,
    });
  }
});

miscRoutes.post('/api/notify/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const settings = await obtenerSettingsPublicos(req.usuarioId);
    if (settings.whatsapp_to.trim() === '') {
      res.status(400).json({ error: 'Configurá el número de WhatsApp antes de hacer una prueba' });
      return;
    }
    const resultado = await enviarWhatsAppConfigurado('🔔 Prueba de recordatorios. La conexión a WhatsApp funciona.', req.usuarioId);
    res.json(resultado);
  } catch (err) {
    console.error('[notify][test]', err);
    res.status(500).json({ error: 'Error al enviar el mensaje de prueba' });
  }
});

miscRoutes.post('/api/reminders/run', requireAuth, async (_req: Request, res: Response) => {
  try {
    const avisos = await revisarVencimientos();
    res.json({ avisos });
  } catch (err) {
    console.error('[reminders][run]', err);
    res.status(500).json({ error: 'Error al revisar vencimientos' });
  }
});