'use client';

/**
 * /dashboard/admin/import/check-files
 *
 * Check Files (AC20) — pre-import linter only:
 * - File upload (no import — dry-lint only)
 * - Shows: missing columns, duplicate rows, malformed dates, unknown rooms, suspicious totals
 * - "This will NOT import data" warning
 */

import { useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { uploadCsvDryRun } from '@/app/actions/imports';
import type { ActionResult } from '@/lib/errors';

// Type-only import — erased at compile time, safe in client component
type ImportDryRunResult = import('@/lib/schemas/imports').ImportDryRunResult;

const IMPORT_TYPE_VALUES = [
  { value: 'monthly_billed'    as const },
  { value: 'monthly_collected' as const },
  { value: 'monthly_summary'   as const },
  { value: 'room_performance'  as const },
];

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CURRENT_YEAR  = new Date().getFullYear();

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface LintIssue {
  rowNumber?: number;
  message: string;
  severity: 'error' | 'warning';
}

function IssueBadge({ severity }: { severity: 'error' | 'warning' }) {
  return severity === 'error' ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">Error</span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">Advertencia</span>
  );
}

export default function CheckFilesPage() {
  const t = useTranslations('adminImport');
  const IMPORT_TYPES = IMPORT_TYPE_VALUES.map((item) => ({
    value: item.value,
    label: t(`csv.types.${item.value}`),
  }));

  const [importType, setImportType] = useState<string>(IMPORT_TYPE_VALUES[0].value);
  const [file,       setFile]       = useState<File | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [result,     setResult]     = useState<ActionResult<ImportDryRunResult> | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.size <= MAX_FILE_BYTES) {
      setFile(dropped);
      setResult(null);
    } else if (dropped) {
      alert('El archivo supera el límite de 5 MB.');
    }
  };

  const handleCheck = async () => {
    if (!file) return;
    setIsChecking(true);
    setResult(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const formData = new FormData();
      formData.set('importType', importType);
      formData.set('period',     `${CURRENT_YEAR}-01`); // period doesn't matter for lint-only
      formData.set('filename',   file.name);
      formData.set('fileBase64', fileBase64);
      const res = await uploadCsvDryRun(null as unknown as ActionResult, formData);
      setResult(res);
    } catch {
      setResult({ error: { code: 'INTERNAL', message: 'Error inesperado al analizar el archivo.' } });
    } finally {
      setIsChecking(false);
    }
  };

  const lintIssues: LintIssue[] = [];
  let totalRows = 0;
  let validRows = 0;

  if (result?.data && !result.error) {
    totalRows = result.data.totalRows;
    validRows = result.data.validRows;

    for (const item of result.data.errorSummary) {
      lintIssues.push({
        rowNumber: item.rowNumber,
        message:   item.message,
        severity:  'error',
      });
    }

    // Add row-level warnings from the rows array
    for (const row of result.data.rows) {
      if (row.status === 'warning' && row.errorDetail) {
        lintIssues.push({
          rowNumber: row.rowNumber,
          message:   row.errorDetail,
          severity:  'warning',
        });
      }
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Warning banner */}
      <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 mt-0.5 shrink-0" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <div className="text-sm text-blue-800">
          <span className="font-semibold">Solo verificación — NO importa datos.</span>{' '}
          Esta herramienta analiza el archivo y reporta problemas sin escribir nada en la base de datos.
          Usa la pestaña &quot;CSV Mensual&quot; para importar datos reales.
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-base font-semibold text-slate-800">Verificar archivo</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="check-type" className="block text-xs font-medium text-slate-600 mb-1">
              Tipo de archivo
            </label>
            <select
              id="check-type"
              value={importType}
              onChange={(e) => { setImportType(e.target.value); setResult(null); }}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-brand-500 outline-none"
            >
              {IMPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* File drop zone */}
        {file ? (
          <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              </svg>
              <span className="truncate max-w-xs">{file.name}</span>
              <span className="text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
            </div>
            <button
              type="button"
              onClick={() => { setFile(null); setResult(null); }}
              className="text-xs text-red-500 hover:underline ml-2"
            >
              Quitar
            </button>
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
            aria-label="Seleccionar archivo CSV para verificar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-slate-400 mb-2" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <p className="text-sm text-slate-500">Arrastra un CSV o <span className="text-brand-600 font-medium">haz clic para seleccionar</span></p>
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
            setResult(null);
          }}
        />

        <button
          type="button"
          onClick={handleCheck}
          disabled={!file || isChecking}
          className="px-5 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isChecking ? 'Verificando...' : 'Verificar archivo'}
        </button>
      </div>

      {/* Error from action */}
      {result?.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700" role="alert">
          <span className="font-medium">Error:</span> {result.error.message}
        </div>
      )}

      {/* Lint results */}
      {result?.data && !result.error && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden" data-testid="check-files-results">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800">Resultado del análisis</h3>
          </div>

          {/* Summary tiles */}
          <div className="grid grid-cols-4 gap-0 border-b border-slate-100">
            <div className="p-4 text-center border-r border-slate-100">
              <div className="text-xl font-bold text-slate-700">{totalRows}</div>
              <div className="text-xs text-slate-500 mt-0.5">Total filas</div>
            </div>
            <div className="p-4 text-center border-r border-slate-100">
              <div className="text-xl font-bold text-green-700">{validRows}</div>
              <div className="text-xs text-green-600 mt-0.5">Válidas</div>
            </div>
            <div className="p-4 text-center border-r border-slate-100">
              <div className="text-xl font-bold text-amber-700">{result.data.warningRows}</div>
              <div className="text-xs text-amber-600 mt-0.5">Advertencias</div>
            </div>
            <div className="p-4 text-center">
              <div className="text-xl font-bold text-red-700">{result.data.invalidRows}</div>
              <div className="text-xs text-red-600 mt-0.5">Errores</div>
            </div>
          </div>

          {/* Issues list */}
          {lintIssues.length === 0 ? (
            <div className="px-5 py-6 flex items-center gap-3 text-green-700">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <span className="text-sm font-medium">Sin problemas detectados. El archivo está listo para importar.</span>
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-96 overflow-y-auto">
              {lintIssues.slice(0, 50).map((issue, i) => (
                <div key={i} className="px-5 py-3 flex items-start gap-3">
                  <IssueBadge severity={issue.severity} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-slate-700">{issue.message}</span>
                  </div>
                  {issue.rowNumber !== undefined && (
                    <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">Fila {issue.rowNumber}</span>
                  )}
                </div>
              ))}
              {lintIssues.length > 50 && (
                <div className="px-5 py-3 text-sm text-slate-400 text-center">
                  Y {lintIssues.length - 50} problemas más...
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
