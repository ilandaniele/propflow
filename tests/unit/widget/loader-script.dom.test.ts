// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildLoaderScript } from '@/lib/widget/loader-script';

function runLoader(key: string) {
  const tag = document.createElement('script');
  tag.dataset.key = key;
  document.body.appendChild(tag);
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => tag });
  new Function(buildLoaderScript('https://app.example.com'))();
}

describe('widget loader in the host page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts the launcher on load without creating the iframe yet', () => {
    runLoader('pk_TESTTESTTESTTESTTESTTEST');
    expect(document.querySelector('button[aria-label="Abrir chat"]')).not.toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('opens the chat iframe when the launcher is clicked', () => {
    runLoader('pk_TESTTESTTESTTESTTESTTEST');
    document.querySelector<HTMLButtonElement>('button[aria-label="Abrir chat"]')!.click();
    expect(document.querySelector('iframe')?.getAttribute('src')).toBe('https://app.example.com/widget/pk_TESTTESTTESTTESTTESTTEST');
  });

  it('mounts nothing when the public key is invalid', () => {
    runLoader('not-a-key');
    expect(document.querySelector('button')).toBeNull();
  });
});
