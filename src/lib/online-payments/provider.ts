import { env, serverEnv } from '@/lib/env';
import { createMercadoPagoAdapter } from './mercadopago';
import { sandboxAdapter } from './sandbox';
import type { PaymentProviderAdapter } from './types';

export function mercadoPagoCredentials(): { accessToken: string; webhookSecret: string } | null {
  const accessToken = serverEnv.MERCADOPAGO_ACCESS_TOKEN;
  const webhookSecret = serverEnv.MERCADOPAGO_WEBHOOK_SECRET;
  return accessToken && webhookSecret ? { accessToken, webhookSecret } : null;
}

export function getActivePaymentAdapter(): PaymentProviderAdapter {
  const credentials = mercadoPagoCredentials();
  return credentials ? createMercadoPagoAdapter(credentials.accessToken, env.NEXT_PUBLIC_SITE_URL) : sandboxAdapter;
}
