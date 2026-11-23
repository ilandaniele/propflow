export type ProviderName = 'sandbox' | 'mercadopago';

export type IntentStatus = 'pending' | 'paid' | 'expired' | 'failed';

export interface CheckoutInput {
  intentId: string;
  chargeId: string;
  token: string;
  title: string;
  amount: string;
  currency: string;
  expiresAt: Date;
}

export interface CheckoutResult {
  providerRef: string | null;
  checkoutUrl: string | null;
}

export interface PaymentProviderAdapter {
  name: ProviderName;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
}
