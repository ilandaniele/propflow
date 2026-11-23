'use client';

import { useActionState, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { saveOrgSignature } from '@/app/actions/org-signature';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import SignatureCanvas, { type SignatureCanvasHandle } from '@/components/ui/SignatureCanvas';
import type { OrgSignature } from '@/lib/contracts/org-signature';
import type { ActionResult } from '@/lib/errors';

export function OrgSignatureForm({ current }: { current: OrgSignature | null }) {
  const t = useTranslations('orgSignature');
  const canvasRef = useRef<SignatureCanvasHandle>(null);
  const [drawn, setDrawn] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(saveOrgSignature, null);

  function submit(formData: FormData) {
    const image = drawn ? canvasRef.current?.getDataUrl() : null;
    if (image) formData.set('signature_image', image);
    formAction(formData);
  }

  return (
    <form action={submit} className="space-y-4">
      {current && (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
          <img src={current.imageDataUrl} alt={t('currentAlt')} className="h-16 w-auto border border-slate-200 rounded bg-white" />
          <p className="text-sm text-slate-600">{t('current', { name: current.signerName })}</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={t('signerName')} name="signer_name" required defaultValue={current?.signerName ?? ''} />
        <Input label={t('signerDocument')} name="signer_document" defaultValue={current?.signerDocument ?? ''} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-700">{t('draw')}</p>
        <SignatureCanvas ref={canvasRef} onDrawn={setDrawn} />
        <button type="button" onClick={() => canvasRef.current?.clear()} className="text-xs text-slate-500 hover:underline">
          {t('clear')}
        </button>
      </div>
      <Button type="submit" disabled={pending || !drawn}>{pending ? t('saving') : t('save')}</Button>
      {state?.error && <p className="text-sm text-red-600" role="alert">{t('error')}</p>}
      {state && !state.error && <p className="text-sm text-green-700" role="status">{t('saved')}</p>}
    </form>
  );
}
