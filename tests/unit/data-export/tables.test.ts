import { describe, it, expect } from 'vitest';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { EXPORT_TABLES } from '@/lib/data-export/tables';

const SECRET_RE = /password|hash|token|secret|api_?key|session|credential|storage_path|url/i;
const FORBIDDEN_TABLES = [
  'users', 'accounts', 'sessions', 'verification_tokens', 'profiles', 'api_keys',
  'owner_portal_links', 'calendar_connections', 'org_channels',
];
const REQUIRED_FILES = [
  'propiedades.csv', 'unidades.csv', 'propietarios.csv', 'inquilinos.csv', 'contratos.csv',
  'cargos.csv', 'pagos.csv', 'gastos.csv', 'incidencias.csv', 'documentos.csv',
];

describe('EXPORT_TABLES whitelist', () => {
  it('covers every main entity once', () => {
    const files = EXPORT_TABLES.map((t) => t.file);
    expect(new Set(files).size).toBe(files.length);
    for (const file of REQUIRED_FILES) expect(files).toContain(file);
  });

  it('never exports auth, session or credential tables', () => {
    const names = EXPORT_TABLES.map((t) => getTableName(t.table));
    for (const forbidden of FORBIDDEN_TABLES) expect(names).not.toContain(forbidden);
  });

  it.each(EXPORT_TABLES.map((t) => [t.file, t] as const))('%s has no secret-looking header or column', (_file, spec) => {
    for (const [header, column] of Object.entries(spec.columns)) {
      expect(header).not.toMatch(SECRET_RE);
      expect(column.name).not.toMatch(SECRET_RE);
    }
  });

  it.each(EXPORT_TABLES.map((t) => [t.file, t] as const))('%s only lists columns of its own org-scoped table, id first', (_file, spec) => {
    const own = new Set(Object.values(getTableColumns(spec.table)));
    expect(getTableColumns(spec.table).orgId).toBeDefined();
    expect(Object.keys(spec.columns)[0]).toBe('id');
    for (const column of Object.values(spec.columns)) expect(own.has(column)).toBe(true);
  });

  it('leaves internal and file-path columns out', () => {
    const exported = new Map(EXPORT_TABLES.map((t) => [getTableName(t.table), new Set(Object.values(t.columns).map((c) => c.name))]));
    expect(exported.get('tenants')).not.toContain('profile_id');
    expect(exported.get('tenants')).not.toContain('reliability_scores');
    expect(exported.get('documents')).not.toContain('storage_path');
    expect(exported.get('contracts')).not.toContain('keynua_contract_id');
    expect(exported.get('payments')).not.toContain('approved_by');
    for (const columns of exported.values()) expect(columns).not.toContain('org_id');
  });
});
