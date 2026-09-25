import { describe, it, expect } from 'vitest';
import { renderWidgetFrame } from '@/lib/widget/frame-html';

const BASE = {
  nonce: 'abc123nonce',
  publicKey: 'pk_ABCDEFGHIJKLMNOPQRSTUVWX',
  orgName: 'Acme Realty',
  greeting: 'Hola!',
  accentColor: '#112233',
  allowedOrigins: ['https://host-a.example.com', 'https://host-b.example.com'],
  initialListingRef: 'depa-sol-a1b2c3',
};

describe('renderWidgetFrame', () => {
  it('carries the nonce on every inline <script>/<style> tag', () => {
    const html = renderWidgetFrame(BASE);
    const scriptTags = html.match(/<script\b[^>]*>/g) ?? [];
    const styleTags = html.match(/<style\b[^>]*>/g) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of [...scriptTags, ...styleTags]) {
      expect(tag).toContain(`nonce="${BASE.nonce}"`);
    }
  });

  it('embeds the allowed origins for the frame runtime to check postMessage against', () => {
    const html = renderWidgetFrame(BASE);
    expect(html).toContain('https://host-a.example.com');
    expect(html).toContain('https://host-b.example.com');
  });

  it('escapes `</script>` inside an org-provided greeting so it cannot break out of the inline script', () => {
    const html = renderWidgetFrame({ ...BASE, greeting: '</script><script>alert(1)</script>' });
    expect(html).not.toContain('</script><script>alert(1)</script>');
    // The dangerous substring must not survive verbatim — every '<' from the
    // greeting is JSON-escaped to < before being embedded.
    const configScriptMatch = html.match(/window\.__PF_CONFIG__ = (.*?);<\/script>/);
    expect(configScriptMatch).not.toBeNull();
    expect(configScriptMatch![1]).toContain('\\u003c');
    expect(configScriptMatch![1]).not.toContain('</script>');
  });

  it('falls back to the default accent color for an invalid accentColor', () => {
    const html = renderWidgetFrame({ ...BASE, accentColor: 'not-a-color' });
    expect(html).not.toContain('--pf-accent: not-a-color');
    expect(html).toContain('--pf-accent: #2563eb');
  });

  it('renders replies via textContent, never assigns innerHTML with data', () => {
    const html = renderWidgetFrame(BASE);
    expect(html).not.toMatch(/\.innerHTML\s*=/);
    expect(html).toContain('bubble.textContent = text');
  });

  it('CTA links open in a new tab with rel=noopener', () => {
    const html = renderWidgetFrame(BASE);
    expect(html).toContain('a.target = "_blank"');
    expect(html).toContain('a.rel = "noopener"');
  });

  it('falls back to an in-memory token when localStorage is unavailable', () => {
    const html = renderWidgetFrame(BASE);
    expect(html).toContain('var memToken = null;');
    expect(html).toContain('memToken = token || null;');
    expect(html).toMatch(/return memToken;/);
  });

  it('replays the transcript on load via GET /api/agent/web/messages when a token exists', () => {
    const html = renderWidgetFrame(BASE);
    expect(html).toContain('function loadTranscript()');
    expect(html).toContain('/api/agent/web/messages?publicKey=');
    expect(html).toContain('"Authorization": "Bearer " + token');
    expect(html).toContain('loadTranscript();');
    // Rendered strictly via textContent, same as live replies.
    expect(html).toContain('addBubble(m.role, m.text);');
  });
});
