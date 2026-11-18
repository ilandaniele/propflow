import { describe, it, expect } from 'vitest';
import { escapeLike } from './like';

describe('escapeLike', () => {
  it('escapes %, _ and the escape character itself', () => {
    expect(escapeLike('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('leaves plain text untouched', () => {
    expect(escapeLike('Miraflores')).toBe('Miraflores');
  });
});
