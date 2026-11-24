import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildNubefactPayload,
  createNubefactProvider,
  sandboxProvider,
  selectProvider,
  type EinvoiceDocument,
} from '@/lib/einvoice/providers';

const logMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/log', () => ({ log: logMock }));

const URL_STUB = 'https://nubefact.test/api/v1/route-stub';
const TOKEN_STUB = 'stub-token-not-real';

const doc: EinvoiceDocument = {
  docType: 'factura',
  series: 'F001',
  number: 7,
  customerDocType: 'ruc',
  customerDocNumber: '20131312955',
  customerName: 'Empresa SAC',
  total: '1180.00',
  base: '1000.00',
  igv: '180.00',
  description: 'Alquiler 2026-11',
  issueDate: new Date('2026-11-30T15:00:00Z'),
};

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('buildNubefactPayload', () => {
  it('maps a factura to the generar_comprobante JSON', () => {
    const payload = buildNubefactPayload(doc);
    expect(payload).toMatchObject({
      operacion: 'generar_comprobante',
      tipo_de_comprobante: 1,
      serie: 'F001',
      numero: 7,
      cliente_tipo_de_documento: '6',
      cliente_numero_de_documento: '20131312955',
      cliente_denominacion: 'Empresa SAC',
      fecha_de_emision: '30-11-2026',
      moneda: 1,
      porcentaje_de_igv: 18,
      total_gravada: '1000.00',
      total_igv: '180.00',
      total: '1180.00',
    });
    expect(payload.items).toEqual([expect.objectContaining({
      cantidad: 1,
      descripcion: 'Alquiler 2026-11',
      valor_unitario: '1000.00',
      precio_unitario: '1180.00',
      subtotal: '1000.00',
      tipo_de_igv: 1,
      igv: '180.00',
      total: '1180.00',
    })]);
  });

  it('maps boletas with DNI or without document', () => {
    expect(buildNubefactPayload({ ...doc, docType: 'boleta', customerDocType: 'dni', customerDocNumber: '12345678' }))
      .toMatchObject({ tipo_de_comprobante: 2, cliente_tipo_de_documento: '1', cliente_numero_de_documento: '12345678' });
    expect(buildNubefactPayload({ ...doc, docType: 'boleta', customerDocType: 'none', customerDocNumber: null }))
      .toMatchObject({ tipo_de_comprobante: 2, cliente_tipo_de_documento: '-', cliente_numero_de_documento: '-' });
  });

  it('uses the Lima calendar date', () => {
    expect(buildNubefactPayload({ ...doc, issueDate: new Date('2026-12-01T04:00:00Z') }).fecha_de_emision).toBe('30-11-2026');
  });
});

describe('nubefact provider', () => {
  it('POSTs the payload with the token header and a timeout', async () => {
    const fetchMock = stubFetch(Response.json({ aceptada_por_sunat: true, enlace_del_pdf: 'https://nubefact.test/doc.pdf' }));
    const result = await createNubefactProvider(URL_STUB, TOKEN_STUB).emit(doc);

    expect(result).toMatchObject({ status: 'accepted', pdfUrl: 'https://nubefact.test/doc.pdf', error: null });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_STUB);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Token token="${TOKEN_STUB}"`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual(buildNubefactPayload(doc));
  });

  it('marks documents not yet accepted by SUNAT as sent', async () => {
    stubFetch(Response.json({ aceptada_por_sunat: false }));
    expect((await createNubefactProvider(URL_STUB, TOKEN_STUB).emit(doc)).status).toBe('sent');
  });

  it('returns rejected with the provider error', async () => {
    stubFetch(Response.json({ errors: 'El numero de RUC no es valido', codigo: 20 }, { status: 400 }));
    const result = await createNubefactProvider(URL_STUB, TOKEN_STUB).emit(doc);
    expect(result).toMatchObject({ status: 'rejected', error: 'El numero de RUC no es valido', pdfUrl: null });
  });

  it('returns error on timeout and never logs the token', async () => {
    stubFetch(new DOMException('timed out', 'TimeoutError'));
    const result = await createNubefactProvider(URL_STUB, TOKEN_STUB).emit(doc);
    expect(result).toMatchObject({ status: 'error', error: 'timeout' });
    expect(JSON.stringify(logMock.warn.mock.calls)).not.toContain(TOKEN_STUB);
  });
});

describe('selectProvider', () => {
  it('defaults to the sandbox without Nubefact env vars', async () => {
    vi.stubEnv('NUBEFACT_API_URL', '');
    vi.stubEnv('NUBEFACT_API_TOKEN', '');
    expect(selectProvider().name).toBe('sandbox');
    vi.stubEnv('NUBEFACT_API_URL', URL_STUB);
    expect(selectProvider().name).toBe('sandbox');
  });

  it('uses Nubefact when both env vars are set', () => {
    vi.stubEnv('NUBEFACT_API_URL', URL_STUB);
    vi.stubEnv('NUBEFACT_API_TOKEN', TOKEN_STUB);
    expect(selectProvider().name).toBe('nubefact');
  });

  it('sandbox accepts without network', async () => {
    const fetchMock = stubFetch(new Error('no network'));
    expect((await sandboxProvider.emit(doc)).status).toBe('accepted_sandbox');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
