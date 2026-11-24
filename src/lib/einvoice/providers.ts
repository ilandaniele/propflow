import { serverEnv } from '@/lib/env';
import { log } from '@/lib/log';
import type { Amounts, CustomerDocType, DocType } from './calc';

export const PROVIDERS = ['sandbox', 'nubefact'] as const;
export type ProviderName = (typeof PROVIDERS)[number];
export type EmitStatus = 'accepted_sandbox' | 'sent' | 'accepted' | 'rejected' | 'error';

export interface EinvoiceDocument extends Amounts {
  docType: DocType;
  series: string;
  number: number;
  customerDocType: CustomerDocType;
  customerDocNumber: string | null;
  customerName: string;
  description: string;
  issueDate: Date;
}

export interface EmitResult {
  status: EmitStatus;
  providerResponse: unknown;
  pdfUrl: string | null;
  error: string | null;
}

export interface EinvoiceProvider {
  name: ProviderName;
  emit(doc: EinvoiceDocument): Promise<EmitResult>;
}

export const sandboxProvider: EinvoiceProvider = {
  name: 'sandbox',
  async emit(doc) {
    return {
      status: 'accepted_sandbox',
      providerResponse: { sandbox: true, serie: doc.series, numero: doc.number },
      pdfUrl: null,
      error: null,
    };
  },
};

const NUBEFACT_TIMEOUT_MS = 15_000;
const NUBEFACT_DOC_TYPE: Record<DocType, number> = { factura: 1, boleta: 2 };
const NUBEFACT_CUSTOMER_DOC: Record<CustomerDocType, string> = { ruc: '6', dni: '1', none: '-' };

function limaDate(date: Date): string {
  const [day, month, year] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date).split('/');
  return `${day}-${month}-${year}`;
}

export function buildNubefactPayload(doc: EinvoiceDocument) {
  return {
    operacion: 'generar_comprobante',
    tipo_de_comprobante: NUBEFACT_DOC_TYPE[doc.docType],
    serie: doc.series,
    numero: doc.number,
    sunat_transaction: 1,
    cliente_tipo_de_documento: NUBEFACT_CUSTOMER_DOC[doc.customerDocType],
    cliente_numero_de_documento: doc.customerDocNumber ?? '-',
    cliente_denominacion: doc.customerName,
    cliente_direccion: '',
    cliente_email: '',
    fecha_de_emision: limaDate(doc.issueDate),
    moneda: 1,
    porcentaje_de_igv: 18.0,
    total_gravada: doc.base,
    total_igv: doc.igv,
    total: doc.total,
    enviar_automaticamente_a_la_sunat: true,
    enviar_automaticamente_al_cliente: false,
    items: [{
      unidad_de_medida: 'ZZ',
      codigo: '001',
      descripcion: doc.description,
      cantidad: 1,
      valor_unitario: doc.base,
      precio_unitario: doc.total,
      subtotal: doc.base,
      tipo_de_igv: 1,
      igv: doc.igv,
      total: doc.total,
      anticipo_regularizacion: false,
    }],
  };
}

interface NubefactResponse {
  errors?: unknown;
  aceptada_por_sunat?: boolean;
  enlace_del_pdf?: string;
}

export function createNubefactProvider(url: string, token: string): EinvoiceProvider {
  return {
    name: 'nubefact',
    async emit(doc) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Token token="${token}"`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildNubefactPayload(doc)),
          signal: AbortSignal.timeout(NUBEFACT_TIMEOUT_MS),
        });
      } catch (e) {
        const error = e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network_error';
        log.warn('[einvoice] nubefact request failed', { error, series: doc.series, number: doc.number });
        return { status: 'error', providerResponse: null, pdfUrl: null, error };
      }

      const body = (await response.json().catch(() => null)) as NubefactResponse | null;
      if (!response.ok || !body || body.errors) {
        const error = body?.errors ? String(body.errors).slice(0, 500) : `http_${response.status}`;
        log.warn('[einvoice] nubefact rejected', { status: response.status, series: doc.series, number: doc.number });
        return { status: 'rejected', providerResponse: body, pdfUrl: null, error };
      }
      return {
        status: body.aceptada_por_sunat ? 'accepted' : 'sent',
        providerResponse: body,
        pdfUrl: body.enlace_del_pdf ?? null,
        error: null,
      };
    },
  };
}

export function selectProvider(): EinvoiceProvider {
  const url = serverEnv.NUBEFACT_API_URL;
  const token = serverEnv.NUBEFACT_API_TOKEN;
  return url && token ? createNubefactProvider(url, token) : sandboxProvider;
}
