import { describe, it, expect } from 'vitest';
import { toE164 } from '@/lib/whatsapp/phone';

describe('toE164', () => {
  it('adds a leading + to a bare digit string (Meta inbound format)', () => {
    expect(toE164('51987654321')).toBe('+51987654321');
  });

  it('leaves an already-E.164 number unchanged', () => {
    expect(toE164('+51987654321')).toBe('+51987654321');
  });

  it('strips whitespace and punctuation', () => {
    expect(toE164(' +51 987-654-321 ')).toBe('+51987654321');
  });
});
