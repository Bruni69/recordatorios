export type OrigenFactura = 'email' | 'manual';
export type EstadoFactura = 'pendiente' | 'pagada' | 'revisar';
export type Moneda = 'ARS' | 'USD' | 'OTRA';

export interface Factura {
  id: number;
  proveedor: string;
  monto: number;
  moneda: Moneda;
  fecha_vencimiento: string;
  estado: EstadoFactura;
  origen: OrigenFactura;
  email: string | null;
  notas: string | null;
  aviso_semana_enviado: boolean;
  aviso_48hs_enviado: boolean;
  creada_en: string;
}

export interface NuevaFactura {
  proveedor: string;
  monto: number;
  moneda: Moneda;
  fecha_vencimiento: string;
  notas?: string | null;
  estado?: EstadoFactura;
}

export interface DatoFacturaEmail {
  proveedor: string;
  monto: number;
  moneda: Moneda;
  fecha_vencimiento: string;
  email: string;
  notas: string;
}

export interface SettingsPublic {
  whatsapp_to: string;
  email_configurado: boolean;
}

export interface FilaFactura {
  id: number;
  proveedor: string;
  monto: string;
  moneda: string;
  fecha_vencimiento: string;
  estado: string;
  origen: string;
  email: string | null;
  notas: string | null;
  aviso_semana_enviado: boolean;
  aviso_48hs_enviado: boolean;
  creada_en: string;
  user_id: number;
}

export function filaAFactura(fila: FilaFactura): Factura {
  return {
    id: fila.id,
    proveedor: fila.proveedor,
    monto: Number(fila.monto),
    moneda: fila.moneda as Moneda,
    fecha_vencimiento: fila.fecha_vencimiento,
    estado: fila.estado as EstadoFactura,
    origen: fila.origen as OrigenFactura,
    email: fila.email,
    notas: fila.notas,
    aviso_semana_enviado: fila.aviso_semana_enviado,
    aviso_48hs_enviado: fila.aviso_48hs_enviado,
    creada_en: fila.creada_en,
  };
}