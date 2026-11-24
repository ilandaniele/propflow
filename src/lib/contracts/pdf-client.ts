'use client';

/**
 * Browser-side contract PDF generation. The renderer is imported on demand so
 * @react-pdf/renderer is never part of the server bundle.
 */

import { getContractPdfSource, saveContractPdf } from '@/app/actions/contractDoc';
import { getSignatureCertificateSource } from '@/app/actions/signature-certificate';
import { actionErrorMessage, type ActionResult } from '@/lib/errors';
import type { CertificateLabels } from './certificate-document.tsx';

function unwrap<T>(result: ActionResult<T>): T {
  if (result.error || result.data === undefined) {
    throw new Error(result.error ? actionErrorMessage(result.error) : 'Empty response');
  }
  return result.data;
}

export async function generateAndSaveContractPdf(contractId: string, templateId: string): Promise<void> {
  const sourceForm = new FormData();
  sourceForm.set('contract_id', contractId);
  sourceForm.set('template_id', templateId);
  const source = unwrap(await getContractPdfSource({}, sourceForm));

  const { renderContractPdfBlob } = await import('./pdf-document.tsx');
  const blob = await renderContractPdfBlob(source);

  const saveForm = new FormData();
  saveForm.set('contract_id', contractId);
  saveForm.set('file', new File([blob], 'contract.pdf', { type: 'application/pdf' }));
  const saved = await saveContractPdf({}, saveForm);
  if (saved.error) throw new Error(actionErrorMessage(saved.error));
}

export async function renderSignatureCertificate(signatureRequestId: string, labels: CertificateLabels): Promise<Blob> {
  const form = new FormData();
  form.set('signature_request_id', signatureRequestId);
  const source = unwrap(await getSignatureCertificateSource({}, form));
  const { renderCertificatePdfBlob } = await import('./certificate-document.tsx');
  return renderCertificatePdfBlob(source, labels);
}
