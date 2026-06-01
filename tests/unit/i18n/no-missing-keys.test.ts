/**
 * i18n completeness check: verifies all keys in es.json exist in en.json and pt.json.
 * Fails CI if any key is missing in any locale.
 */

import { describe, it, expect } from 'vitest';
import esMessages from '@/messages/es.json';
import enMessages from '@/messages/en.json';
import ptMessages from '@/messages/pt.json';

function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      keys.push(...collectKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

describe('i18n — no missing keys', () => {
  const esKeys = collectKeys(esMessages);

  it('all es.json keys exist in en.json', () => {
    const missing: string[] = [];
    for (const key of esKeys) {
      const val = getNestedValue(enMessages as unknown as Record<string, unknown>, key);
      if (val === undefined || val === '') {
        missing.push(key);
      }
    }
    expect(missing, `Missing keys in en.json: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('all es.json keys exist in pt.json', () => {
    const missing: string[] = [];
    for (const key of esKeys) {
      const val = getNestedValue(ptMessages as unknown as Record<string, unknown>, key);
      if (val === undefined || val === '') {
        missing.push(key);
      }
    }
    expect(missing, `Missing keys in pt.json: ${missing.join(', ')}`).toHaveLength(0);
  });

  it('messages files cover all 13 namespaces', () => {
    const namespaces = Object.keys(esMessages);
    const required = [
      'common', 'navigation', 'tenants', 'payments', 'contracts',
      'incidents', 'tasks', 'whatsapp', 'sanctions', 'notifications',
      'validation', 'emptyStates', 'onboarding',
    ];
    for (const ns of required) {
      expect(namespaces, `Namespace "${ns}" missing from es.json`).toContain(ns);
    }
  });
});
