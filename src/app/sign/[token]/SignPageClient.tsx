'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

interface ContractPreview {
  startDate: string;
  endDate: string;
  monthlyRent: number;
  unitLabel: string;
  propertyName: string;
  propertyAddress: string;
  tenantName: string;
}

type PageState = 'loading' | 'ready' | 'signing' | 'signed' | 'expired' | 'already_signed' | 'error';

interface Props {
  token: string;
}

export default function SignPageClient({ token }: Props) {
  const [state, setState] = useState<PageState>('loading');
  const [contract, setContract] = useState<ContractPreview | null>(null);
  const [typedName, setTypedName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [activeTab, setActiveTab] = useState<'type' | 'draw'>('type');

  // Load contract preview
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/sign/${token}`);
      if (res.status === 404) { setState('expired'); return; }
      if (!res.ok) { setState('error'); return; }
      const data = await res.json();
      setContract(data.contract);
      setState('ready');
    })();
  }, [token]);

  // Canvas drawing
  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    isDrawing.current = true;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  }
  function draw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    setHasDrawn(true);
  }
  function endDraw() { isDrawing.current = false; }
  function clearCanvas() {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      setHasDrawn(false);
    }
  }

  function getSignatureDataUrl(): string | null {
    if (activeTab === 'type') {
      if (!typedName.trim()) return null;
      // Render typed name onto a canvas
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 400, 100);
      ctx.fillStyle = '#1e293b';
      ctx.font = 'italic 40px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(typedName.trim().slice(0, 40), 200, 50);
      return canvas.toDataURL('image/png');
    } else {
      if (!hasDrawn || !canvasRef.current) return null;
      return canvasRef.current.toDataURL('image/png');
    }
  }

  async function handleSubmit() {
    const sigDataUrl = getSignatureDataUrl();
    if (!sigDataUrl) { setErrorMsg('Please provide a signature.'); return; }

    setState('signing');
    const res = await fetch(`/api/sign/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signature_image_base64: sigDataUrl,
        typed_name: typedName || 'drawn',
      }),
    });

    if (res.status === 409) { setState('already_signed'); return; }
    if (res.status === 404) { setState('expired'); return; }
    if (!res.ok) { setState('error'); setErrorMsg('Submission failed. Please try again.'); return; }

    setState('signed');
  }

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading contract…</p>
      </div>
    );
  }

  if (state === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <h1 className="text-xl font-semibold text-slate-900">Link Expired</h1>
          <p className="text-slate-500">This signature link has expired or is no longer valid.</p>
        </div>
      </div>
    );
  }

  if (state === 'already_signed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <h1 className="text-xl font-semibold text-slate-900">Already Signed</h1>
          <p className="text-slate-500">This contract has already been signed.</p>
        </div>
      </div>
    );
  }

  if (state === 'signed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Contract Signed</h1>
          <p className="text-slate-500">Your signature has been recorded. Thank you!</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <h1 className="text-xl font-semibold text-red-700">Something went wrong</h1>
          <p className="text-slate-500">{errorMsg || 'Please try again or contact your landlord.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="h-8 w-8 rounded-lg bg-brand-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-xs font-bold" aria-hidden="true">P</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900">Sign Your Contract</h1>
          <p className="text-sm text-slate-500 mt-1">Review the details below and provide your signature.</p>
        </div>

        {/* Contract summary */}
        {contract && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-2 text-sm">
            <h2 className="font-semibold text-slate-900 mb-3">Contract Summary</h2>
            <div className="grid grid-cols-2 gap-1 text-slate-700">
              <span className="text-slate-500">Tenant:</span><span>{contract.tenantName}</span>
              <span className="text-slate-500">Property:</span><span>{contract.propertyName}</span>
              <span className="text-slate-500">Unit:</span><span>{contract.unitLabel}</span>
              <span className="text-slate-500">Address:</span><span>{contract.propertyAddress}</span>
              <span className="text-slate-500">Period:</span><span>{contract.startDate} — {contract.endDate}</span>
              <span className="text-slate-500">Monthly Rent:</span><span className="font-medium">${contract.monthlyRent}</span>
            </div>
          </div>
        )}

        {/* Signature pad */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="font-semibold text-slate-900">Your Signature</h2>

          {/* Tabs */}
          <div className="flex border-b border-slate-200" role="tablist">
            <button
              role="tab"
              aria-selected={activeTab === 'type'}
              onClick={() => setActiveTab('type')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'type' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Type
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'draw'}
              onClick={() => setActiveTab('draw')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'draw' ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              Draw
            </button>
          </div>

          {activeTab === 'type' ? (
            <div>
              <label htmlFor="typed-name" className="block text-sm text-slate-600 mb-2">Type your full legal name</label>
              <input
                id="typed-name"
                type="text"
                value={typedName}
                onChange={e => setTypedName(e.target.value)}
                placeholder="Your full name"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-900 text-lg italic font-serif focus:outline-none focus:ring-2 focus:ring-brand-500"
                style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}
              />
            </div>
          ) : (
            <div>
              <p className="text-sm text-slate-600 mb-2">Draw your signature in the box below</p>
              <canvas
                ref={canvasRef}
                width={380}
                height={120}
                className="w-full border border-slate-300 rounded-lg bg-white cursor-crosshair"
                style={{ touchAction: 'none' }}
                onPointerDown={startDraw}
                onPointerMove={draw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
                aria-label="Signature drawing pad"
              />
              <button onClick={clearCanvas} className="mt-1 text-xs text-slate-500 hover:text-slate-700 underline">
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Consent + submit */}
        <div className="space-y-3">
          {errorMsg && (
            <p className="text-sm text-red-600" role="alert">{errorMsg}</p>
          )}
          <Button
            onClick={handleSubmit}
            disabled={state === 'signing'}
            className="w-full"
          >
            {state === 'signing' ? 'Submitting…' : 'I Agree — Sign Contract'}
          </Button>
          <p className="text-xs text-center text-slate-400">
            By clicking &ldquo;I Agree&rdquo;, you acknowledge that this electronic signature is binding.
            This is not a legally-qualified eIDAS/ESIGN-certified signature.
          </p>
        </div>
      </div>
    </div>
  );
}
