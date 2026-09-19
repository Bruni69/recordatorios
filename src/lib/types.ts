export type EstadoFactura = 'pendiente' | 'pagada' | 'revisar';
export type Moneda = 'ARS' | 'USD' | 'OTRA';
export type OrigenFactura = 'email' | 'manual';

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

export interface SettingsPublic {
  whatsapp_to: string;
  email_configurado: boolean;
}

export interface ConfigEmailPublic {
  configurado: boolean;
  host: string;
  port: number;
  user: string;
}