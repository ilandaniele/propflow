import { describe, it, expect } from 'vitest';
import { buildWhatsAppTemplate } from '@/lib/whatsapp/templates';

describe('buildWhatsAppTemplate', () => {
  // ── paymentDue ───────────────────────────────────────────────────────────────
  describe('paymentDue', () => {
    it('es: returns Spanish payment-due message', () => {
      const msg = buildWhatsAppTemplate('paymentDue', 'es', { amount: '500', date: '2026-06-01' });
      expect(msg).toContain('500');
      expect(msg).toContain('2026-06-01');
      expect(msg).toMatch(/pago/i);
    });

    it('en: returns English payment-due message', () => {
      const msg = buildWhatsAppTemplate('paymentDue', 'en', { amount: '500', date: '2026-06-01' });
      expect(msg).toContain('500');
      expect(msg).toContain('2026-06-01');
      expect(msg).toMatch(/payment/i);
    });

    it('pt: returns Portuguese payment-due message', () => {
      const msg = buildWhatsAppTemplate('paymentDue', 'pt', { amount: '500', date: '2026-06-01' });
      expect(msg).toContain('500');
      expect(msg).toContain('2026-06-01');
      expect(msg).toMatch(/pagamento/i);
    });

    it('unknown locale falls back to es', () => {
      const es = buildWhatsAppTemplate('paymentDue', 'es', { amount: '100', date: '2026-01-01' });
      const unknown = buildWhatsAppTemplate('paymentDue', 'xx', { amount: '100', date: '2026-01-01' });
      expect(unknown).toBe(es);
    });
  });

  // ── paymentConfirmed ─────────────────────────────────────────────────────────
  describe('paymentConfirmed', () => {
    it('es/en/pt produce different strings', () => {
      const es = buildWhatsAppTemplate('paymentConfirmed', 'es', { amount: '200' });
      const en = buildWhatsAppTemplate('paymentConfirmed', 'en', { amount: '200' });
      const pt = buildWhatsAppTemplate('paymentConfirmed', 'pt', { amount: '200' });
      expect(es).not.toBe(en);
      expect(en).not.toBe(pt);
      expect(pt).not.toBe(es);
    });

    it('all locales include the amount', () => {
      for (const locale of ['es', 'en', 'pt']) {
        const msg = buildWhatsAppTemplate('paymentConfirmed', locale, { amount: '350' });
        expect(msg).toContain('350');
      }
    });
  });

  // ── paymentPending ────────────────────────────────────────────────────────────
  describe('paymentPending', () => {
    it('es returns Spanish pending message (no params needed)', () => {
      const msg = buildWhatsAppTemplate('paymentPending', 'es');
      expect(msg.length).toBeGreaterThan(5);
    });

    it('en returns English pending message', () => {
      const msg = buildWhatsAppTemplate('paymentPending', 'en');
      expect(msg).toMatch(/receipt|review/i);
    });

    it('pt returns Portuguese pending message', () => {
      const msg = buildWhatsAppTemplate('paymentPending', 'pt');
      expect(msg).toMatch(/comprovante|análise/i);
    });
  });

  // ── receiptDuplicate ─────────────────────────────────────────────────────────
  describe('receiptDuplicate', () => {
    it('es says the receipt was already processed', () => {
      const msg = buildWhatsAppTemplate('receiptDuplicate', 'es');
      expect(msg).toMatch(/procesado/i);
    });

    it('en says already processed', () => {
      const msg = buildWhatsAppTemplate('receiptDuplicate', 'en');
      expect(msg).toMatch(/already.*processed/i);
    });

    it('pt says already processed', () => {
      const msg = buildWhatsAppTemplate('receiptDuplicate', 'pt');
      expect(msg).toMatch(/processado/i);
    });
  });

  // ── taskReminder ─────────────────────────────────────────────────────────────
  describe('taskReminder', () => {
    it('includes task title and due date in all locales', () => {
      for (const locale of ['es', 'en', 'pt']) {
        const msg = buildWhatsAppTemplate('taskReminder', locale, { title: 'Fix roof', date: '2026-07-01' });
        expect(msg).toContain('Fix roof');
        expect(msg).toContain('2026-07-01');
      }
    });
  });

  // ── taskCompleted ─────────────────────────────────────────────────────────────
  describe('taskCompleted', () => {
    it('includes task title in all locales', () => {
      for (const locale of ['es', 'en', 'pt']) {
        const msg = buildWhatsAppTemplate('taskCompleted', locale, { title: 'Inspect boiler' });
        expect(msg).toContain('Inspect boiler');
      }
    });
  });

  // ── sanctionApproved ─────────────────────────────────────────────────────────
  describe('sanctionApproved', () => {
    it('includes amount and reason in all locales', () => {
      for (const locale of ['es', 'en', 'pt']) {
        const msg = buildWhatsAppTemplate('sanctionApproved', locale, { amount: '150', reason: 'Late payment' });
        expect(msg).toContain('150');
        expect(msg).toContain('Late payment');
      }
    });
  });

  // ── leaseRenewal ─────────────────────────────────────────────────────────────
  describe('leaseRenewal', () => {
    it('includes days and date in all locales', () => {
      for (const locale of ['es', 'en', 'pt']) {
        const msg = buildWhatsAppTemplate('leaseRenewal', locale, { days: '30', date: '2026-08-01' });
        expect(msg).toContain('30');
        expect(msg).toContain('2026-08-01');
      }
    });
  });
});
