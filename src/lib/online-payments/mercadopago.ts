import { z } from 'zod';
import { payLinkPath } from './token';
import type { CheckoutInput, PaymentProviderAdapter } from './types';

const MERCADOPAGO_API = 'https://api.mercadopago.com';
const FETCH_TIMEOUT_MS = 10_000;
export const MERCADOPAGO_WEBHOOK_PATH = '/api/webhooks/mercadopago';

const PreferenceResponseSchema = z.object({ id: z.string(), init_point: z.string().startsWith('https://') });

const PaymentResponseSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  status: z.string(),
  external_reference: z.string().nullable().optional(),
  transaction_amount: z.number(),
  currency_id: z.string(),
});

export type MercadoPagoPayment = z.infer<typeof PaymentResponseSchema>;

export function buildPreferencePayload(input: CheckoutInput, siteUrl: string) {
  const backUrl = `${siteUrl}${payLinkPath(input.token)}`;
  return {
    items: [{
      id: input.chargeId,
      title: input.title,
      quantity: 1,
      unit_price: Number(input.amount),
      currency_id: input.currency,
    }],
    external_reference: input.intentId,
    notification_url: `${siteUrl}${MERCADOPAGO_WEBHOOK_PATH}`,
    back_urls: { success: backUrl, pending: backUrl, failure: backUrl },
    auto_return: 'approved',
    expires: true,
    expiration_date_to: input.expiresAt.toISOString(),
  };
}

async function mercadoPagoFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${MERCADOPAGO_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`mercadopago ${path.split('/')[1]} request failed: ${response.status}`);
  return response.json();
}

export function createMercadoPagoAdapter(accessToken: string, siteUrl: string): PaymentProviderAdapter {
  return {
    name: 'mercadopago',
    async createCheckout(input) {
      const body = JSON.stringify(buildPreferencePayload(input, siteUrl));
      const preference = PreferenceResponseSchema.parse(
        await mercadoPagoFetch('/checkout/preferences', accessToken, { method: 'POST', body }),
      );
      return { providerRef: preference.id, checkoutUrl: preference.init_point };
    },
  };
}

export async function fetchMercadoPagoPayment(paymentId: string, accessToken: string): Promise<MercadoPagoPayment> {
  return PaymentResponseSchema.parse(await mercadoPagoFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, accessToken));
}
