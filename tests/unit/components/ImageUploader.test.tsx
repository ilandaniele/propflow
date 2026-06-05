// @vitest-environment jsdom

/**
 * tests/unit/components/ImageUploader.test.tsx
 *
 * Tests:
 *  1. Renders the upload button with the correct label
 *  2. Rejects files with invalid MIME type (shows error message)
 *  3. Rejects files that exceed 5 MB (shows error message)
 *  4. Accepts a valid file and calls onUpload
 *  5. Shows error message when onUpload returns an error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ImageUploader } from '@/components/images/ImageUploader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  document.body.removeChild(container);
});

const LABELS = {
  uploadLabel: 'Subir imagen',
  invalidMimeMessage: 'Tipo de archivo no permitido.',
  fileTooLargeMessage: 'Archivo muy grande.',
  uploadErrorMessage: 'Error al subir.',
};

function makeFile(type: string, sizeBytes: number, name = 'test.jpg'): File {
  // Create a Blob of the correct size
  const blob = new Blob([new Uint8Array(sizeBytes)], { type });
  return new File([blob], name, { type });
}

function renderUploader(onUpload: (file: File) => Promise<unknown>) {
  const root = createRoot(container);
  act(() => {
    root.render(
      <ImageUploader
        uploadLabel={LABELS.uploadLabel}
        invalidMimeMessage={LABELS.invalidMimeMessage}
        fileTooLargeMessage={LABELS.fileTooLargeMessage}
        uploadErrorMessage={LABELS.uploadErrorMessage}
        onUpload={onUpload as (file: File) => Promise<{ error?: { code: string; message: string } } | void>}
      />
    );
  });
}

function getFileInput(): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

function getErrorAlert(): HTMLElement | null {
  return container.querySelector('[role="alert"]');
}

async function simulateFileSelection(file: File) {
  const input = getFileInput();
  // We can't set files directly on a real input; use Object.defineProperty
  Object.defineProperty(input, 'files', {
    value: { 0: file, length: 1, item: () => file },
    configurable: true,
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImageUploader — rendering', () => {
  it('renders upload button with correct label', () => {
    renderUploader(vi.fn());
    const button = container.querySelector('button');
    expect(button?.textContent).toContain(LABELS.uploadLabel);
  });

  it('renders a hidden file input accepting image types', () => {
    renderUploader(vi.fn());
    const input = getFileInput();
    expect(input).not.toBeNull();
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
  });

  it('renders no error message initially', () => {
    renderUploader(vi.fn());
    expect(getErrorAlert()).toBeNull();
  });
});

describe('ImageUploader — file validation', () => {
  it('shows invalidMimeMessage for a gif file (not in allowlist)', async () => {
    renderUploader(vi.fn());
    const gifFile = makeFile('image/gif', 100, 'image.gif');
    await simulateFileSelection(gifFile);
    const alert = getErrorAlert();
    expect(alert?.textContent).toContain(LABELS.invalidMimeMessage);
  });

  it('shows invalidMimeMessage for a pdf file', async () => {
    renderUploader(vi.fn());
    const pdfFile = makeFile('application/pdf', 100, 'doc.pdf');
    await simulateFileSelection(pdfFile);
    expect(getErrorAlert()?.textContent).toContain(LABELS.invalidMimeMessage);
  });

  it('shows fileTooLargeMessage for a file exceeding 5 MB', async () => {
    renderUploader(vi.fn());
    const bigFile = makeFile('image/jpeg', 5_242_881, 'big.jpg'); // 1 byte over limit
    await simulateFileSelection(bigFile);
    expect(getErrorAlert()?.textContent).toContain(LABELS.fileTooLargeMessage);
  });

  it('accepts a valid jpeg file at the limit (5 MB exactly)', async () => {
    const onUpload = vi.fn().mockResolvedValue({});
    renderUploader(onUpload);
    const file = makeFile('image/jpeg', 5_242_880, 'ok.jpg');
    await simulateFileSelection(file);
    expect(onUpload).toHaveBeenCalledWith(file);
    expect(getErrorAlert()).toBeNull();
  });

  it('accepts a valid png file', async () => {
    const onUpload = vi.fn().mockResolvedValue({});
    renderUploader(onUpload);
    const file = makeFile('image/png', 1024, 'ok.png');
    await simulateFileSelection(file);
    expect(onUpload).toHaveBeenCalledWith(file);
  });

  it('accepts a valid webp file', async () => {
    const onUpload = vi.fn().mockResolvedValue({});
    renderUploader(onUpload);
    const file = makeFile('image/webp', 1024, 'ok.webp');
    await simulateFileSelection(file);
    expect(onUpload).toHaveBeenCalledWith(file);
  });
});

describe('ImageUploader — upload result handling', () => {
  it('shows uploadErrorMessage when onUpload returns an error object', async () => {
    const onUpload = vi.fn().mockResolvedValue({ error: { code: 'INTERNAL_ERROR', message: 'failed' } });
    renderUploader(onUpload);
    const file = makeFile('image/jpeg', 100, 'ok.jpg');
    await simulateFileSelection(file);
    expect(getErrorAlert()?.textContent).toContain(LABELS.uploadErrorMessage);
  });

  it('shows uploadErrorMessage when onUpload throws', async () => {
    const onUpload = vi.fn().mockRejectedValue(new Error('network error'));
    renderUploader(onUpload);
    const file = makeFile('image/jpeg', 100, 'ok.jpg');
    await simulateFileSelection(file);
    expect(getErrorAlert()?.textContent).toContain(LABELS.uploadErrorMessage);
  });

  it('clears error message after a successful upload', async () => {
    // First fail, then succeed
    const onUpload = vi.fn()
      .mockResolvedValueOnce({ error: { code: 'INTERNAL_ERROR', message: 'oops' } })
      .mockResolvedValueOnce({});

    renderUploader(onUpload);

    // Fail
    await simulateFileSelection(makeFile('image/jpeg', 100, 'ok.jpg'));
    expect(getErrorAlert()).not.toBeNull();

    // Succeed
    await simulateFileSelection(makeFile('image/png', 100, 'ok2.png'));
    expect(getErrorAlert()).toBeNull();
  });
});
