import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs runner without type declarations
import { pendingMigrations, BASELINE_FILES } from '../../scripts/migrate.mjs';

describe('scripts/migrate.mjs pendingMigrations', () => {
  it('returns unapplied numbered .sql files in filename order', () => {
    const files = ['0004_b.sql', 'README.md', '0003_a.sql', '0010_c.sql', 'notes.sql'];
    expect(pendingMigrations(files, ['0003_a.sql'])).toEqual(['0004_b.sql', '0010_c.sql']);
  });

  it('skips the hand-applied baseline files once recorded', () => {
    const files = [...BASELINE_FILES, '0003_agent_phase0.sql'];
    expect(pendingMigrations(files, BASELINE_FILES)).toEqual(['0003_agent_phase0.sql']);
  });

  it('returns nothing when everything is applied', () => {
    expect(pendingMigrations(['0001_x.sql'], ['0001_x.sql'])).toEqual([]);
  });
});
