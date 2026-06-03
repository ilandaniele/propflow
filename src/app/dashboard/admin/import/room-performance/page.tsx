'use client';

/**
 * /dashboard/admin/import/room-performance
 *
 * Step 2: Room Performance CSV Upload
 * - Upload card for Room Performance CSV
 * - Earnings Month + Year selectors
 * - "Upload Room Performance" button → dry-run + commit
 */

import { useState, useRef, useCallback } from 'react';
import { uploadCsvDryRun, commitCsvImport } from '@/app/actions/imports';
import type { ActionResult } from '@/lib/errors';

// Type-only imports — erased at compile time, safe in client components
type ImportDryRunResult = import('@/lib/schemas/imports').ImportDryRunResult;
type ImportCommitResult = import('@/lib/schemas/imports').ImportCommitResult;

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 3 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = [
  { value: '01', label: 'Enero' },
  { value: '02', label: 'Febrero' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Abril' },
  { value: '05', label: 'Mayo' },
  { value: '06', label: 'Junio' },
  { value: '07', label: 'Julio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Septiembre' },
  { value: '10', label: 'Octubre' },
  { value: '11', label: 'Noviembre' },
  { value: '12', label: 'Diciembre' },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function RoomPerformancePage() {
  const now = new Date();
  const [year,  setYear]  = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [file,  setFile]  = useState<File | null>(null);

  const [dryRunResult, setDryRunResult] = useState<ActionResult<ImportDryRunResult> | null>(null);
  const [commitResult, setCommitResult] = useState<ActionResult<ImportCommitResult> | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [step, setStep] = useState<'idle' | 'dry_run_done' | 'committed'>('idle');

  const inputRef = useRef<HTMLInputElement>(null);

  const period = `${year}-${month}`;

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.size <= MAX_FILE_BYTES) {
      setFile(dropped);
      setDryRunResult(null);
      setCommitResult(null);
      setStep('idle');
    } else if (dropped) {
      alert('El archivo supera el límite de 5 MB.');
    }
  }, []);

  const handleUploadAndDryRun = async () => {
    if (!file) return;
    setIsRunning(true);
    setDryRunResult(null);
    setCommitResult(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const formData = new FormData();
      formData.set('importType', 'room_performance');
      formData.set('period',     period);
      formData.set('filename',   file.name);
      formData.set('fileBase64', fileBase64);
      const result = await uploadCsvDryRun(null as unknown as ActionResult, formData);
      setDryRunResult(result);
      if (!result.error && (result.data?.validRows ?? 0) > 0) {
        setStep('dry_run_done');
      }
    } catch {
      setDryRunResult({ error: { code: 'INTERNAL', message: 'Error inesperado.' } });
    } finally {
      setIsRunning(false);
    }
  };

  const handleCommit = async () => {
    if (!dryRunResult || dryRunResult.error || !dryRunResult.data || !file) return;
    setIsRunning(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const formData = new FormData();
      formData.set('importId',   dryRunResult.data.csvImportId);
      formData.set('importType', 'room_performance');
      formData.set('period',     period);
      formData.set('fileBase64', fileBase64);
      const result = await commitCsvImport(null as unknown as ActionResult, formData);
      setCommitResult(result);
      if (!('error' in result)) setStep('committed');
    } catch {
      setCommitResult({ error: { code: 'INTERNAL', message: 'Error inesperado.' } });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <h2 className="text-lg font-semibold text-slate-800">Paso 2 — Rendimiento de habitaciones</h2>
        <p className="text-sm text-slate-500">
          Sube el CSV de rendimiento mensual por habitación (ocupación, ingresos, gastos).
        </p>

        {/* Period selectors */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="rp-year" className="block text-xs font-medium text-slate-600 mb-1">Año</label>
            <select
              id="rp-year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            >
              {YEARS.map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rp-month" className="block text-xs font-medium text-slate-600 mb-1">Mes</label>
            <select
              id="rp-month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            >
              {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* File drop zone */}
        {file ? (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span className="truncate max-w-xs">{file.name}</span>
              <span className="text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
            </div>
            <button type="button" onClick={() => { setFile(null); setDryRunResult(null); setCommitResult(null); setStep('idle'); }} className="text-xs text-red-500 hover:underline ml-2">Quitar</button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-brand-400 transition-colors"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            aria-label="Subir CSV de rendimiento de habitaciones"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-slate-400 mb-2" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p className="text-sm text-slate-500">Arrastra un CSV o <span className="text-brand-600 font-medium">haz clic</span></p>
            <p className="text-xs text-slate-400 mt-1">Máximo 5 MB</p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > MAX_FILE_BYTES) { alert('El archivo supera el límite de 5 MB.'); return; }
            setFile(f);
            setDryRunResult(null);
            setCommitResult(null);
            setStep('idle');
          }}
        />

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleUploadAndDryRun}
            disabled={!file || isRunning || step === 'committed'}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isRunning && step === 'idle' ? 'Analizando...' : 'Subir rendimiento'}
          </button>

          {step === 'dry_run_done' && (
            <button
              type="button"
              onClick={handleCommit}
              disabled={isRunning}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? 'Confirmando...' : 'Confirmar importación'}
            </button>
          )}
        </div>

        {/* Error alerts */}
        {dryRunResult?.error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
            {dryRunResult.error.message}
          </div>
        )}

        {/* Dry-run summary */}
        {dryRunResult?.data && !dryRunResult.error && step !== 'committed' && (
          <div className="grid grid-cols-3 gap-3" data-testid="rp-dry-run-summary">
            <div className="text-center p-3 bg-green-50 rounded-lg">
              <div className="text-xl font-bold text-green-700">{dryRunResult.data.validRows}</div>
              <div className="text-xs text-green-600 mt-1">Válidas</div>
            </div>
            <div className="text-center p-3 bg-amber-50 rounded-lg">
              <div className="text-xl font-bold text-amber-700">{dryRunResult.data.warningRows}</div>
              <div className="text-xs text-amber-600 mt-1">Advertencias</div>
            </div>
            <div className="text-center p-3 bg-red-50 rounded-lg">
              <div className="text-xl font-bold text-red-700">{dryRunResult.data.invalidRows}</div>
              <div className="text-xs text-red-600 mt-1">Errores</div>
            </div>
          </div>
        )}

        {/* Commit success */}
        {step === 'committed' && commitResult?.data && !commitResult.error && (
          <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700" role="status">
            <span className="font-medium">Importacion completada.</span>{' '}
            {commitResult.data.rowsWritten} filas escritas para el periodo {period}.
          </div>
        )}

        {commitResult?.error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
            {commitResult.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
