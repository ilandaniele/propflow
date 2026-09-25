import { describe, it, expect } from 'vitest';
import { buildLoaderScript } from '@/lib/widget/loader-script';

describe('buildLoaderScript', () => {
  const script = buildLoaderScript('https://app.example.com');

  it('embeds the given app origin', () => {
    expect(script).toContain('https://app.example.com');
  });

  it('checks event.origin before trusting a postMessage', () => {
    expect(script).toMatch(/event\.origin\s*!==\s*APP_ORIGIN/);
  });

  it('checks event.source against the iframe it created', () => {
    expect(script).toMatch(/event\.source\s*!==\s*iframe\.contentWindow/);
  });

  it('never uses innerHTML to render host- or server-supplied data', () => {
    expect(script).not.toMatch(/innerHTML/);
  });

  it('never calls eval or the Function constructor', () => {
    expect(script).not.toMatch(/\beval\s*\(/);
    expect(script).not.toMatch(/new Function/);
  });

  it('validates the public key against the pk_ pattern before doing anything else', () => {
    expect(script).toMatch(/pk_\[A-Za-z0-9\]\{24\}/);
  });

  it('exposes window.PropflowWidget with open/close/setListing', () => {
    expect(script).toContain('window.PropflowWidget');
    expect(script).toContain('open:');
    expect(script).toContain('close:');
    expect(script).toContain('setListing:');
  });
});
