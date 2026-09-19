import nodemailer from 'nodemailer';
import { config } from '../config.js';

export interface ResultadoEnvio {
    enviado: boolean;
    motivo: string;
    to: string;
}

export async function enviarEmailAviso(destinatario: string, asunto: string, cuerpo: string): Promise<ResultadoEnvio> {
    const { host, port, user, password, from } = config.smtp;

    if (!user || !password) {
        console.log(`[email][skip] SMTP no configurado. Destino: ${destinatario}`);
        return { enviado: false, motivo: 'SMTP no configurado', to: destinatario };
    }

    const transporter = nodemailer.createTransport({
        host,
        port,
        secure: false,
        auth: { user, pass: password },
    });

    try {
        await transporter.sendMail({
            from,
            to: destinatario,
            subject: asunto,
            text: cuerpo,
        });
        console.log(`[email][ok] Enviado a ${destinatario}: ${asunto}`);
        return { enviado: true, motivo: '', to: destinatario };
    } catch (err) {
        console.error(`[email][error] Fallo al enviar a ${destinatario}:`, err);
        return { enviado: false, motivo: String(err), to: destinatario };
    }
}