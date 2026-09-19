import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, validarConfiguracion } from './config.js';
import { pool, testConexion } from './db.js';
import { asegurarMigracion } from './migracion.js';
import { authRoutes } from './routes/authRoutes.js';
import { facturaRoutes } from './routes/facturaRoutes.js';
import { miscRoutes } from './routes/miscRoutes.js';
import { iniciarScheduler, revisarVencimientos } from './reminders/scheduler.js';

const app = express();
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((o) => o.trim()) }));
app.use(express.json());

app.use(authRoutes);
app.use(facturaRoutes);
app.use(miscRoutes);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const produccion = process.env.NODE_ENV === 'production';

if (produccion) {
  const distClient = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(distClient, 'assets'))) {
    app.use(express.static(distClient));
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api/')) return next();
      const destino = path.join(distClient, 'index.html');
      if (fs.existsSync(destino)) {
        res.sendFile(destino);
      } else {
        next();
      }
    });
  }
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

async function main(): Promise<void> {
  const validacion = validarConfiguracion();
  if (!validacion.ok) {
    console.error('❌ Configuración inválida:');
    validacion.errores.forEach((e) => console.error(`   - ${e}`));
    console.error('Creá/ajustá el archivo .env (ver .env.example) y reintentá.');
    process.exit(1);
  }

  if (!config.databaseUrl) {
    console.error('❌ Falta DATABASE_URL en .env. Creá un proyecto Supabase y configurá la conexión.');
    process.exit(1);
  }

  await testConexion();
  console.log('✅ Conexión a Supabase (PostgreSQL) establecida.');

  await asegurarMigracion();
  iniciarScheduler();

  app.listen(config.port, () => {
    console.log(`✅ API en http://localhost:${config.port}`);
  });

  revisarVencimientos().catch((err) => console.error('[reminders][inicio]', err));
}

const cerrar = (senial: string): void => {
  console.log(`\n[${senial}] Cerrando servidor...`);
  pool.end().then(() => process.exit(0));
};

process.on('SIGINT', () => cerrar('SIGINT'));
process.on('SIGTERM', () => cerrar('SIGTERM'));

main().catch((err) => {
  console.error('Error fatal al iniciar:', err);
  process.exit(1);
});