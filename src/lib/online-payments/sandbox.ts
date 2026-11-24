import type { PaymentProviderAdapter } from './types';

export const sandboxAdapter: PaymentProviderAdapter = {
  name: 'sandbox',
  async createCheckout() {
    return { providerRef: null, checkoutUrl: null };
  },
};
