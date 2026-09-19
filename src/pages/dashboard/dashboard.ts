import { api, ApiError, logout, requireAuth } from '../../lib/api';
import type { EstadoFactura, Factura, Moneda } from '../../lib/types';

requireAuth();

const cuerpoTabla = document.getElementById('cuerpo-facturas') as HTMLTableSectionElement;
const sinDatos = document.getElementById('sin-datos') as HTMLParagraphElement;
const formError = document.getElementById('form-error') as HTMLParagraphElement;
const tituloForm = document.getElementById('titulo-form') as HTMLHeadingElement;
const btnCancelar = document.getElementById('btn-cancelar-edicion') as HTMLButtonElement;
const statsCont = document.getElementById('estadisticas') as HTMLElement;
const filtrosCont = document.getElementById('filtros') as HTMLElement;

const form = document.getElementById('factura-form') as HTMLFormElement;
const proveedorInput = document.getElementById('proveedor') as HTMLInputElement;
const montoInput = document.getElementById('monto') as HTMLInputElement;
const monedaSelect = document.getElementById('moneda') as HTMLSelectElement;
const fechaInput = document.getElementById('fecha') as HTMLInputElement;
const notasInput = document.getElementById('notas') as HTMLTextAreaElement;
const btnGuardar = document.getElementById('btn-guardar') as HTMLButtonElement;
const btnLogout = document.getElementById('btn-logout') as HTMLButtonElement;

interface EstadoFiltro {
  actual: string;
  editando: number;
}

const estado = { actual: '', editando: 0 } satisfies EstadoFiltro;

let facturas: Factura[] = [];
let timerToast: number | undefined;

function mostrarToast(texto: string): void {
  const toast = document.getElementById('toast') as HTMLDivElement;
  toast.textContent = texto;
  toast.classList.add('visible');
  if (timerToast !== undefined) window.clearTimeout(timerToast);
  timerToast = window.setTimeout(() => toast.classList.remove('visible'), 2500);
}

function formatearMonto(factura: Factura): string {
  const literal = factura.monto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return factura.moneda === 'USD' ? `U$S ${literal}` : `$${literal}`;
}

function formatearFecha(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const fecha = new Date(a!, m! - 1, d!);
  return fecha.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function diasHasta(iso: string): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const [a, m, d] = iso.split('-').map(Number);
  const vencimiento = new Date(a!, m! - 1, d!);
  vencimiento.setHours(0, 0, 0, 0);
  return Math.round((vencimiento.getTime() - hoy.getTime()) / 86_400_000);
}

function textoPlazo(iso: string): string {
  const dias = diasHasta(iso);
  if (dias < 0) return `Vencida hace ${Math.abs(dias)} día(s)`;
  if (dias === 0) return 'Vence hoy';
  return `Faltan ${dias} días`;
}

function etiquetaEstado(estadoFactura: EstadoFactura): string {
  if (estadoFactura === 'pagada') return 'Pagada';
  if (estadoFactura === 'revisar') return 'Revisar';
  return 'Pendiente';
}

function clasePlazo(estadoFactura: EstadoFactura, vencimiento: string): string {
  if (estadoFactura === 'pagada') return 'texto-mensaje';
  const dias = diasHasta(vencimiento);
  if (dias < 0 || dias <= 2) return 'aviso error';
  if (dias <= 7) return 'aviso';
  return 'texto-secundario';
}

type AccionFactura = 'pagar' | 'reactivar' | 'editar' | 'eliminar';

function crearBotonAccion(texto: string, clase: string, factura: Factura, accion: AccionFactura): HTMLButtonElement {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `${clase} chico`;
  boton.textContent = texto;
  boton.addEventListener('click', () => void ejecutarAccion(boton, factura, accion));
  return boton;
}

async function ejecutarAccion(boton: HTMLButtonElement, factura: Factura, accion: AccionFactura): Promise<void> {
  boton.disabled = true;
  try {
    if (accion === 'pagar') {
      await api.actualizarFactura(factura.id, { estado: 'pagada' });
      mostrarToast(`Factura de ${factura.proveedor} marcada como pagada.`);
      await refrescar();
      return;
    }
    if (accion === 'reactivar') {
      await api.actualizarFactura(factura.id, { estado: 'pendiente' });
      mostrarToast(`Factura de ${factura.proveedor} reactivada.`);
      await refrescar();
      return;
    }
    if (accion === 'eliminar') {
      if (!confirm(`¿Eliminar la factura de ${factura.proveedor}?`)) {
        boton.disabled = false;
        return;
      }
      await api.eliminarFactura(factura.id);
      mostrarToast(`Factura de ${factura.proveedor} eliminada.`);
      await refrescar();
      return;
    }
    if (accion === 'editar') {
      estado.editando = factura.id;
      tituloForm.textContent = `Editar: ${factura.proveedor}`;
      proveedorInput.value = factura.proveedor;
      montoInput.value = String(factura.monto);
      monedaSelect.value = factura.moneda;
      fechaInput.value = factura.fecha_vencimiento;
      notasInput.value = factura.notas ?? '';
      btnCancelar.hidden = false;
      formError.hidden = true;
      mostrarToast('Completá los cambios y guardá.');
      document.getElementById('titulo-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  } catch (err) {
    mostrarErrorForm(err);
    mostrarToast(err instanceof ApiError ? err.message : 'Error inesperado al realizar la acción.');
  } finally {
    boton.disabled = false;
  }
}

function crearCelda(contenido: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = contenido;
  return td;
}

function crearCeldaConSub(principal: string, secundario: string, claseSecundario = 'texto-mensaje'): HTMLTableCellElement {
  const td = document.createElement('td');
  const fuerte = document.createElement('div');
  fuerte.textContent = principal;
  td.appendChild(fuerte);
  const suave = document.createElement('div');
  suave.className = claseSecundario;
  suave.textContent = secundario;
  td.appendChild(suave);
  return td;
}

function crearBadge(estadoFactura: EstadoFactura): HTMLTableCellElement {
  const td = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge ${estadoFactura === 'pagada' ? 'pagada' : estadoFactura === 'revisar' ? 'revisar' : 'pendiente'}`;
  badge.textContent = etiquetaEstado(estadoFactura);
  td.appendChild(badge);
  return td;
}

function crearCeldaAcciones(f: Factura): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'acciones';
  if (f.estado === 'pagada') {
    td.appendChild(crearBotonAccion('Reactivar', 'boton ok', f, 'reactivar'));
    return td;
  }
  td.appendChild(crearBotonAccion('Pagar', 'boton ok', f, 'pagar'));
  td.appendChild(crearBotonAccion('Editar', 'boton secundario', f, 'editar'));
  td.appendChild(crearBotonAccion('Borrar', 'boton peligro', f, 'eliminar'));
  return td;
}

function crearFila(f: Factura): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.appendChild(crearCeldaConSub(f.proveedor, f.email ?? ''));
  tr.appendChild(crearCelda(formatearMonto(f)));
  tr.appendChild(
    crearCeldaConSub(formatearFecha(f.fecha_vencimiento), textoPlazo(f.fecha_vencimiento), clasePlazo(f.estado, f.fecha_vencimiento))
  );
  tr.appendChild(crearBadge(f.estado));
  tr.appendChild(crearCelda(f.origen === 'email' ? 'Email' : 'Manual'));
  tr.appendChild(crearCeldaAcciones(f));
  return tr;
}

function limpiar(contenedor: HTMLElement): void {
  while (contenedor.firstChild) contenedor.removeChild(contenedor.firstChild);
}

function renderTabla(lista: Factura[]): void {
  limpiar(cuerpoTabla);
  const filtrada = estado.actual === '' ? lista : lista.filter((f) => f.estado === estado.actual);
  sinDatos.textContent = filtrada.length === 0 ? 'No hay facturas que mostrar.' : '';
  filtrada.forEach((f) => cuerpoTabla.appendChild(crearFila(f)));
}

function crearMetrica(valor: string, etiqueta: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'metrica';
  const v = document.createElement('div');
  v.className = 'valor';
  v.textContent = valor;
  const e = document.createElement('div');
  e.className = 'etiqueta';
  e.textContent = etiqueta;
  div.appendChild(v);
  div.appendChild(e);
  return div;
}

function renderEstadisticas(lista: Factura[]): void {
  limpiar(statsCont);
  const pendientes = lista.filter((f) => f.estado !== 'pagada');
  const enSemana = pendientes.filter((f) => {
    const d = diasHasta(f.fecha_vencimiento);
    return d > 0 && d <= 7;
  });
  const enDos = pendientes.filter((f) => {
    const d = diasHasta(f.fecha_vencimiento);
    return d > 0 && d <= 2;
  });
  const pendienteArs = pendientes
    .filter((f) => f.moneda !== 'USD')
    .reduce((acc, f) => acc + f.monto, 0);

  statsCont.appendChild(crearMetrica(String(pendientes.length), 'Facturas sin pagar'));
  statsCont.appendChild(crearMetrica(String(enSemana.length), 'Vencen en 7 días'));
  statsCont.appendChild(crearMetrica(String(enDos.length), 'Vencen en 48 hs'));
  statsCont.appendChild(crearMetrica(pendienteArs.toLocaleString('es-AR', { maximumFractionDigits: 0 }), 'Pendiente (ARS)'));
}

function activarFiltros(): void {
  filtrosCont.querySelectorAll('button[data-filtro]').forEach((b) => {
    const btn = b as HTMLButtonElement;
    btn.classList.toggle('activo', btn.dataset.filtro === estado.actual);
  });
}

async function refrescar(): Promise<void> {
  try {
    facturas = await api.listarFacturas();
    renderTabla(facturas);
    renderEstadisticas(facturas);
  } catch (err) {
    mostrarErrorForm(err);
  }
}

function mostrarErrorForm(err: unknown): void {
  formError.textContent = err instanceof ApiError ? err.message : 'Error inesperado';
  formError.hidden = false;
}

function limpiarFormulario(): void {
  form.reset();
  estado.editando = 0;
  tituloForm.textContent = 'Nueva factura';
  btnCancelar.hidden = true;
  formError.hidden = true;
}

function leerFormulario(): { proveedor: string; monto: number; moneda: Moneda; fecha: string; notas: string } | null {
  const proveedor = proveedorInput.value.trim();
  const monto = Number(montoInput.value);
  const moneda = monedaSelect.value as Moneda;
  const fecha = fechaInput.value;
  const notas = notasInput.value.trim();
  if (proveedor === '' || monto < 0 || fecha === '') return null;
  return { proveedor, monto, moneda, fecha, notas };
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  formError.hidden = true;
  const datos = leerFormulario();
  if (!datos) {
    mostrarErrorForm(new ApiError('Completá proveedor, monto y fecha'));
    return;
  }
  btnGuardar.disabled = true;
  try {
    if (estado.editando > 0) {
      await api.actualizarFactura(estado.editando, {
        proveedor: datos.proveedor,
        monto: datos.monto,
        moneda: datos.moneda,
        fecha_vencimiento: datos.fecha,
        notas: datos.notas,
      });
    } else {
      await api.crearFactura({
        proveedor: datos.proveedor,
        monto: datos.monto,
        moneda: datos.moneda,
        fecha_vencimiento: datos.fecha,
        notas: datos.notas,
      });
    }
    limpiarFormulario();
    await refrescar();
  } catch (err) {
    mostrarErrorForm(err);
  } finally {
    btnGuardar.disabled = false;
  }
});

btnCancelar.addEventListener('click', limpiarFormulario);

filtrosCont.addEventListener('click', (evento) => {
  const botonFiltro = (evento.target as HTMLElement).closest('button[data-filtro]') as HTMLButtonElement | null;
  if (!botonFiltro) return;
  estado.actual = botonFiltro.dataset.filtro ?? '';
  activarFiltros();
  renderTabla(facturas);
});

btnLogout.addEventListener('click', logout);

void refrescar();