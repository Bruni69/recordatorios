# Recordatorios

Aplicación con Vite, Express y PostgreSQL para registrar facturas y enviar avisos por email.

## Desarrollo

Requiere Node.js 22.13 o superior (Node 24 recomendado para `pdfjs-dist`) y PostgreSQL.

1. Ejecutar `npm ci`.
2. Crear `.env` con `DATABASE_URL`, `JWT_SECRET` (aleatorio, al menos 16 caracteres) y opcionalmente `APP_PASSWORD` (al menos 8 caracteres) y `ADMIN_EMAIL`.
3. Ejecutar `npm run dev`. La API aplica las migraciones automáticamente; Vite usa el puerto 5173 y la API el 3000.
4. Ejecutar `npm run typecheck` y `npm run build` para validar. En producción: `NODE_ENV=production npm start` después del build.

## Facturas desde Gmail

En **Configuración → Captura por email**, guardar la dirección Gmail y una **contraseña de aplicación** de Google (requiere verificación en dos pasos; no usar la contraseña habitual).

El servidor revisa INBOX al arrancar y cada 5 minutos, incluyendo mensajes leídos de los últimos 90 días. Cada ejecución procesa hasta 100 mensajes nuevos para avanzar por el historial sin repetir facturas. El botón **Escanear casilla ahora** permite adelantar una ejecución. Las importaciones aparecen en el dashboard con estado **Revisar**.

Se extraen importes y fechas de vencimiento del asunto, texto del correo y PDF con texto. Los PDF escaneados como imagen requieren OCR y no se interpretan. Los correos sin importe o fecha reconocible no generan facturas. El historial de procesamiento persiste en PostgreSQL por usuario, casilla, UIDVALIDITY y UID; no se cambia la marca de leído del correo.

Para otros proveedores puede configurarse IMAP con `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER` e `IMAP_PASSWORD` en el servidor (casilla global del administrador). No publicar contraseñas ni archivos `.env`.

## Avisos de 72 y 48 horas

Los avisos llegan al **email de registro de la cuenta**. Se envían a 3 y 2 días del vencimiento; como se guarda una fecha sin hora, se trata de días calendario y no de un instante exacto. Si se pierde el aviso de 48 horas, se reintenta hasta el día del vencimiento. No se avisa sobre facturas pagadas o vencidas. Cambiar el vencimiento reinicia los avisos. Los avisos de 72 horas tienen su propia marca, independiente del antiguo aviso semanal.

Con Gmail se usa la misma cuenta y contraseña de aplicación de la captura para enviar por `smtp.gmail.com:465`, con TLS. También puede configurarse un remitente global mediante `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` y opcionalmente `SMTP_FROM` (por defecto usa `SMTP_USER`). El puerto 465 usa TLS implícito y 587 usa STARTTLS.

Los envíos fallidos liberan el aviso para reintentarlo. **Ejecutar revisión ahora** informa si falta configurar el envío o si falla SMTP; solo revisa las facturas de la cuenta conectada. Los recordatorios automáticos son por email; WhatsApp conserva únicamente su prueba manual.

El servidor debe permanecer activo. Variables opcionales:

- `EMAIL_SCAN_CRON`: frecuencia de escaneo (por defecto `*/5 * * * *`).
- `REMINDER_CRON`: revisión independiente de avisos (por defecto `*/5 * * * *`). También se revisan después del escaneo.
- `APP_TIMEZONE`: zona para comparar fechas y ejecutar cron (por defecto `America/Argentina/Buenos_Aires`).

El servidor necesita conectividad IMAP a Gmail en el puerto 993 y SMTP en el puerto 465 (o al proveedor y puerto configurados).

## Pruebas

Usar una base PostgreSQL **de pruebas** accesible por `TEST_DATABASE_URL`:

```sh
TEST_DATABASE_URL=postgresql://usuario@localhost/base_pruebas npm test
```

Las pruebas crean y eliminan un esquema aislado, y simulan IMAP/SMTP: no leen una casilla real ni envían emails. Cubren migraciones, importación, repetición y concurrencia, importes/monedas, avisos de 72/48 horas, aislamiento de usuarios y reintentos.
