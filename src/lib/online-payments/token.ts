const PAY_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function generatePayToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isPayToken(value: string): boolean {
  return PAY_TOKEN_PATTERN.test(value);
}

export function payLinkPath(token: string): string {
  return `/pay/${token}`;
}
