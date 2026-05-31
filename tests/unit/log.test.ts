import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock console to capture output ─────────────────────────────────────────────

const mockLog = vi.fn();
const mockWarn = vi.fn();
const mockError = vi.fn();

vi.stubGlobal('console', {
  log: mockLog,
  warn: mockWarn,
  error: mockError,
});

import { log } from '@/lib/log';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('log', () => {
  describe('info', () => {
    it('calls console.log with a JSON payload', () => {
      log.info('test message', { key: 'value' });
      expect(mockLog).toHaveBeenCalledOnce();
      const output = JSON.parse(mockLog.mock.calls[0][0]);
      expect(output.level).toBe('info');
      expect(output.msg).toBe('test message');
      expect(output.key).toBe('value');
    });

    it('does not log sensitive fields (password, token, cookie)', () => {
      log.info('login', { password: 'secret', token: 'tok', cookie: 'c=v' });
      const output = JSON.parse(mockLog.mock.calls[0][0]);
      expect(output.password).toBeUndefined();
      expect(output.token).toBeUndefined();
      expect(output.cookie).toBeUndefined();
    });
  });

  describe('warn', () => {
    it('calls console.warn', () => {
      log.warn('warning msg', { detail: 'x' });
      expect(mockWarn).toHaveBeenCalledOnce();
      const output = JSON.parse(mockWarn.mock.calls[0][0]);
      expect(output.level).toBe('warn');
      expect(output.msg).toBe('warning msg');
    });
  });

  describe('error', () => {
    it('calls console.error', () => {
      log.error('error msg', { code: 'E001' });
      expect(mockError).toHaveBeenCalledOnce();
      const output = JSON.parse(mockError.mock.calls[0][0]);
      expect(output.level).toBe('error');
      expect(output.msg).toBe('error msg');
      expect(output.code).toBe('E001');
    });
  });

  describe('audit helpers', () => {
    it('authSuccess logs userId and email domain (not full email)', () => {
      log.authSuccess('user-123', 'test@example.com');
      const output = JSON.parse(mockLog.mock.calls[0][0]);
      expect(output.event).toBe('auth_success');
      expect(output.userId).toBe('user-123');
      expect(output.emailDomain).toBe('example.com');
      expect(output.email).toBeUndefined(); // full email must not be logged
    });

    it('authFailure logs email domain and reason', () => {
      log.authFailure('attacker@evil.com', 'wrong_password');
      const output = JSON.parse(mockWarn.mock.calls[0][0]);
      expect(output.event).toBe('auth_failure');
      expect(output.emailDomain).toBe('evil.com');
      expect(output.reason).toBe('wrong_password');
    });

    it('accessDenied logs userId, path, and reason', () => {
      log.accessDenied('user-1', '/admin', 'role_check_failed');
      const output = JSON.parse(mockWarn.mock.calls[0][0]);
      expect(output.event).toBe('access_denied');
      expect(output.userId).toBe('user-1');
      expect(output.path).toBe('/admin');
      expect(output.reason).toBe('role_check_failed');
    });

    it('adminAction logs action and resourceType', () => {
      log.adminAction('admin-1', 'create', 'property', 'prop-abc');
      const output = JSON.parse(mockLog.mock.calls[0][0]);
      expect(output.event).toBe('admin_action');
      expect(output.action).toBe('create');
      expect(output.resourceType).toBe('property');
      expect(output.resourceId).toBe('prop-abc');
    });

    it('paymentApproved logs paymentId and orgId', () => {
      log.paymentApproved('admin-1', 'pay-1', 'org-1');
      const output = JSON.parse(mockLog.mock.calls[0][0]);
      expect(output.event).toBe('payment_approved');
      expect(output.paymentId).toBe('pay-1');
      expect(output.orgId).toBe('org-1');
    });
  });
});
