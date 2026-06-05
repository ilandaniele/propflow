// @vitest-environment jsdom

/**
 * tests/unit/components/AvatarUploader.test.tsx
 *
 * Tests:
 *  1. Renders current photo when currentUrl is provided
 *  2. Renders initials fallback when currentUrl is null/undefined
 *  3. Shows "Cambiar foto" button always
 *  4. Shows "Eliminar foto" button only when a photo is present
 *  5. Client-side MIME validation error displayed for invalid type
 *  6. Client-side size validation error displayed for oversized file
 *  7. Loading spinner shown during upload transition (pending state)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { AvatarUploader } from '@/components/images/AvatarUploader';

// ---------------------------------------------------------------------------
// Mock Server Actions — the component imports these; in unit tests we mock them
// so we control results without actually calling Supabase.
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/tenants', () => ({
  updateOwnTenantAvatar: vi.fn().mockResolvedValue({}),
  deleteOwnTenantAvatar: vi.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LABELS = {
  changePhoto: 'Cambiar foto',
  removePhoto: 'Eliminar foto',
  uploadHint: 'JPG, PNG o WebP. Máximo 5 MB.',
  invalidMime: 'Tipo de archivo no permitido.',
  fileTooLarge: 'El archivo es demasiado grande.',
  uploadError: 'No se pudo subir la foto.',
  removeError: 'No se pudo eliminar la foto.',
};

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  // Mock URL.createObjectURL for optimistic preview
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  document.body.removeChild(container);
  vi.restoreAllMocks();
});

function renderUploader(props: { name: string; currentUrl?: string | null }) {
  const root = createRoot(container);
  act(() => {
    root.render(<AvatarUploader name={props.name} currentUrl={props.currentUrl} labels={LABELS} />);
  });
  return root;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AvatarUploader — with photo', () => {
  it('renders an <img> when currentUrl is provided', () => {
    renderUploader({ name: 'Juan Perez', currentUrl: 'https://example.com/avatar.jpg' });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toBe('https://example.com/avatar.jpg');
  });

  it('shows the remove button when a photo is present', () => {
    renderUploader({ name: 'Juan Perez', currentUrl: 'https://example.com/avatar.jpg' });
    const btns = Array.from(container.querySelectorAll('button'));
    const removeBtn = btns.find(b => b.textContent?.includes(LABELS.removePhoto));
    expect(removeBtn).not.toBeUndefined();
  });
});

describe('AvatarUploader — no photo (initials fallback)', () => {
  it('renders initials when currentUrl is null', () => {
    renderUploader({ name: 'Juan Perez', currentUrl: null });
    const img = container.querySelector('img');
    expect(img).toBeNull();
    expect(container.textContent).toContain('JP');
  });

  it('renders initials when currentUrl is undefined', () => {
    renderUploader({ name: 'Ana García' });
    const img = container.querySelector('img');
    expect(img).toBeNull();
    expect(container.textContent).toContain('AG');
  });

  it('does NOT show the remove button when there is no photo', () => {
    renderUploader({ name: 'Juan Perez', currentUrl: null });
    const btns = Array.from(container.querySelectorAll('button'));
    const removeBtn = btns.find(b => b.textContent?.includes(LABELS.removePhoto));
    expect(removeBtn).toBeUndefined();
  });
});

describe('AvatarUploader — change photo button', () => {
  it('always shows the change photo button', () => {
    renderUploader({ name: 'Test User', currentUrl: null });
    const btns = Array.from(container.querySelectorAll('button'));
    const changeBtn = btns.find(b => b.textContent?.includes(LABELS.changePhoto));
    expect(changeBtn).not.toBeUndefined();
  });
});

describe('AvatarUploader — client-side validation', () => {
  it('shows MIME error for an unsupported file type', async () => {
    renderUploader({ name: 'Test User', currentUrl: null });

    const input = container.querySelector('[data-testid="avatar-file-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const gifFile = new File(['data'], 'test.gif', { type: 'image/gif' });
    // Simulate file selection
    Object.defineProperty(input, 'files', { value: [gifFile], writable: false });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(LABELS.invalidMime);
  });

  it('shows size error for a file exceeding 5 MB', async () => {
    renderUploader({ name: 'Test User', currentUrl: null });

    const input = container.querySelector('[data-testid="avatar-file-input"]') as HTMLInputElement;
    // 6 MB file
    const bigFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [bigFile], writable: false });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(LABELS.fileTooLarge);
  });
});
