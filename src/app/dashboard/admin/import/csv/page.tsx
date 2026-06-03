'use client';

/**
 * /dashboard/admin/import/csv
 *
 * Step 1: Monthly Data Routine
 * - 3 upload cards: Billed, Collected, Summary
 * - Period selector (month + year)
 * - "Validate & Dry Run" button → calls uploadCsvDryRun
 * - Shows dry-run summary (rows ok/warning/error)
 * - "Commit Import" button (enabled only after successful dry-run)
 *
 * AC17: dry-run; AC18: commit; AC21: 5 MB cap
 */

import { useState, useRef, useCallback } from 'react';
import { uploadCsvDryRun, commitCsvImport } from '@/app/actions/imports';
import type { ActionResult } from '@/lib/errors';

// Type-only imports from server schema — erased at compile time, safe in client components
type ImportDryRunResult = import('@/lib/schemas/imports').ImportDryRunResult;
type ImportCommitResult = import('@/lib/schemas/imports').ImportCommitResult;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMPORT_TYPES = [
  { value: 'monthly_billed',    label: 'Facturado mensual',   description: 'Monto facturado por habitación/periodo' },
  { value: 'monthly_collected', label: 'Cobrado mensual',     description: 'Monto cobrado por habitación/periodo' },
  { value: 'monthly_summary',   label: 'Resumen mensual',     description: 'Totales por propiedad/periodo' },
] as const;

const CURRENT_YEAR  = new Date().getFullYear();
const YEARS         = Array.from({ length: 3 }, (_, i) => CURRENT_YEAR - i);
const MONTHS        = [
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

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:...;base64, prefix
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------
// UploadCard sub-component
// ---------------------------------------------------------------------------

interface UploadCardProps {
  label:      string;
  description: string;
  file:       File | null;
  onFile:     (file: File | null) => void;
  error?:     string;
}

function UploadCard({ label, description, file, onFile, error }: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const dropped = e.dataTransfer.files[0];
      if (dropped) {
        if (dropped.size > MAX_FILE_BYTES) {
          alert('El archivo supera el límite de 5 MB.');
          return;
        }
        onFile(dropped);
      }
    },
    [onFile]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_FILE_BYTES) {
      alert('El archivo supera el límite de 5 MB.');
      return;
    }
    onFile(selected);
  };

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        {file && (
          <button
            type="button"
            onClick={() => onFile(null)}
            className="text-xs text-red-500 hover:underline"
          >
            Quitar
          </button>
        )}
      </div>

      {file ? (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded px-3 py-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span className="truncate max-w-xs">{file.name}</span>
          <span className="text-slate-400 ml-auto whitespace-nowrap">
            {(file.size / 1024).toFixed(0)} KB
          </span>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-brand-400 transition-colors"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          aria-label={`Subir archivo CSV: ${label}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-slate-400 mb-2" aria-hidden="true">
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
        onChange={handleChange}
        aria-label={`Archivo CSV para ${label}`}
      />

      {error && (
        <p className="text-xs text-red-600 mt-2" role="alert">{error}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DryRunSummary sub-component
// ---------------------------------------------------------------------------

interface DryRunSummaryProps {
  result: ImportDryRunResult;
}

function DryRunSummary({ result }: DryRunSummaryProps) {
  return (
    <div className="border border-slate-200 rounded-lg p-5 bg-white space-y-4" data-testid="dry-run-summary">
      <h3 className="font-semibold text-slate-800">Resultado del análisis</h3>

      <div className="grid grid-cols-3 gap-4">
        <div className="text-center p-3 bg-green-50 rounded-lg">
          <div className="text-2xl font-bold text-green-700">{result.validRows}</div>
          <div className="text-xs text-green-600 mt-1">Filas válidas</div>
        </div>
        <div className="text-center p-3 bg-amber-50 rounded-lg">
          <div className="text-2xl font-bold text-amber-700">{result.warningRows}</div>
          <div className="text-xs text-amber-600 mt-1">Advertencias</div>
        </div>
        <div className="text-center p-3 bg-red-50 rounded-lg">
          <div className="text-2xl font-bold text-red-700">{result.invalidRows}</div>
          <div className="text-xs text-red-600 mt-1">Errores</div>
        </div>
      </div>

      {result.errorSummary.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-2">Detalle de errores</h4>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {result.errorSummary.slice(0, 20).map((err, i) => (
              <div key={i} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
                <span className="font-medium">Fila {err.rowNumber}:</span>{' '}
                {err.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

type DryRunState = ActionResult<ImportDryRunResult>;
type CommitState = ActionResult<ImportCommitResult>;

export default function CsvImportPage() {
  // Period selector
  const now = new Date();
  const [selectedYear,  setSelectedYear]  = useState(String(now.getFullYear()));
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [selectedType,  setSelectedType]  = useState<string>(IMPORT_TYPES[0].value);

  // File state
  const [file, setFile] = useState<File | null>(null);

  // Dry-run state (manual — not useActionState so we can reuse the file)
  const [dryRunResult, setDryRunResult] = useState<DryRunState | null>(null);
  const [isDryRunning,  setIsDryRunning]  = useState(false);

  // Commit state
  const [commitResult, setCommitResult] = useState<CommitState | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);

  const period = `${selectedYear}-${selectedMonth}`;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleDryRun = async () => {
    if (!file) return;

    setIsDryRunning(true);
    setDryRunResult(null);
    setCommitResult(null);

    try {
      const fileBase64 = await fileToBase64(file);
      const formData = new FormData();
      formData.set('importType', selectedType);
      formData.set('period',     period);
      formData.set('filename',   file.name);
      formData.set('fileBase64', fileBase64);

      const result = await uploadCsvDryRun(null as unknown as ActionResult, formData);
      setDryRunResult(result);
    } catch {
      setDryRunResult({ error: { code: 'INTERNAL', message: 'Error inesperado. Inténtalo de nuevo.' } });
    } finally {
      setIsDryRunning(false);
    }
  };

  const handleCommit = async () => {
    if (!dryRunResult || dryRunResult.error || !dryRunResult.data || !file) return;

    setIsCommitting(true);
    setCommitResult(null);

    try {
      const fileBase64 = await fileToBase64(file);
      const formData = new FormData();
      formData.set('importId',   dryRunResult.data.csvImportId);
      formData.set('importType', selectedType);
      formData.set('period',     period);
      formData.set('fileBase64', fileBase64);

      const result = await commitCsvImport(null as unknown as ActionResult, formData);
      setCommitResult(result);
    } catch {
      setCommitResult({ error: { code: 'INTERNAL', message: 'Error inesperado. Inténtalo de nuevo.' } });
    } finally {
      setIsCommitting(false);
    }
  };

  const canCommit =
    dryRunResult !== null &&
    !dryRunResult.error &&
    (dryRunResult.data?.validRows ?? 0) > 0 &&
    commitResult === null;

  const commitDone = commitResult !== null && !('error' in commitResult);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <h2 className="text-lg font-semibold text-slate-800">Paso 1 — Carga mensual de datos</h2>

        {/* Period + type selectors */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="import-type">
              Tipo de importación
            </label>
            <select
              id="import-type"
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value); setDryRunResult(null); setCommitResult(null); }}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            >
              {IMPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="import-year">
              Año
            </label>
            <select
              id="import-year"
              value={selectedYear}
              onChange={(e) => { setSelectedYear(e.target.value); setDryRunResult(null); setCommitResult(null); }}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            >
              {YEARS.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1" htmlFor="import-month">
              Mes
            </label>
            <select
              id="import-month"
              value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); setDryRunResult(null); setCommitResult(null); }}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none"
            >
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* File upload area */}
        {IMPORT_TYPES.filter((t) => t.value === selectedType).map((t) => (
          <UploadCard
            key={t.value}
            label={t.label}
            description={t.description}
            file={file}
            onFile={(f) => { setFile(f); setDryRunResult(null); setCommitResult(null); }}
          />
        ))}

        {/* Validate & Dry Run button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDryRun}
            disabled={!file || isDryRunning || commitDone}
            className="px-5 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isDryRunning ? 'Analizando...' : 'Validar y simular'}
          </button>

          {dryRunResult && !dryRunResult.error && dryRunResult.data && (
            <button
              type="button"
              onClick={handleCommit}
              disabled={!canCommit || isCommitting}
              className="px-5 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isCommitting ? 'Importando...' : 'Confirmar importación'}
            </button>
          )}
        </div>

        {/* Error from dry-run */}
        {dryRunResult?.error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
            <span className="font-medium">Error:</span> {dryRunResult.error.message}
          </div>
        )}

        {/* Error from commit */}
        {commitResult?.error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
            <span className="font-medium">Error al confirmar:</span> {commitResult.error.message}
          </div>
        )}

        {/* Commit success */}
        {commitDone && commitResult?.data && (
          <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700" role="status">
            <span className="font-medium">Importacion completada.</span>{' '}
            {commitResult.data.rowsWritten} filas escritas.
          </div>
        )}
      </div>

      {/* Dry-run result summary */}
      {dryRunResult && !dryRunResult.error && dryRunResult.data && (
        <DryRunSummary result={dryRunResult.data} />
      )}
    </div>
  );
}
