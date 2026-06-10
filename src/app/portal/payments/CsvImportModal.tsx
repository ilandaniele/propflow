'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/Button';

interface CsvImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  checkUrl: string;
  importUrl: string;
  importType: 'payment' | 'tenant';
}

type Step = 'upload' | 'preview' | 'confirm' | 'progress' | 'result';

interface PreviewRow {
  rowNumber: number;
  [key: string]: unknown;
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  import_id?: string;
}

export function CsvImportModal({
  open,
  onClose,
  onSuccess,
  checkUrl,
  importUrl,
}: CsvImportModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [errors, setErrors] = useState<{ rowNumber: number; field: string; message: string }[]>([]);
  const [warnings, setWarnings] = useState<{ rowNumber: number; field: string; message: string }[]>([]);
  const [rowsValid, setRowsValid] = useState(0);
  const [rowsInvalid, setRowsInvalid] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep('upload');
    setFile(null);
    setPreviewRows([]);
    setErrors([]);
    setWarnings([]);
    setRowsValid(0);
    setRowsInvalid(0);
    setResult(null);
    setErrorsExpanded(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFileSelect(f: File | null) {
    if (!f) return;
    setFile(f);
    setChecking(true);
    setStep('preview');

    const fd = new FormData();
    fd.append('file', f);
    try {
      const res = await fetch(checkUrl, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setErrors([{ rowNumber: 0, field: 'file', message: data.error?.message ?? 'Error al analizar el archivo.' }]);
        setRowsValid(0); setRowsInvalid(1);
      } else {
        setPreviewRows(data.preview_rows ?? []);
        setErrors(data.errors ?? []);
        setWarnings(data.warnings ?? []);
        setRowsValid(data.rows_valid ?? 0);
        setRowsInvalid(data.rows_invalid ?? 0);
      }
    } catch {
      setErrors([{ rowNumber: 0, field: 'file', message: 'Error de red al verificar el archivo.' }]);
    } finally {
      setChecking(false);
    }
  }

  async function handleImport() {
    if (!file) return;
    setStep('progress');
    setImporting(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(importUrl, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setResult({ created: 0, updated: 0, skipped: 0, failed: 1 });
      } else {
        setResult(data);
        onSuccess();
      }
    } catch {
      setResult({ created: 0, updated: 0, skipped: 0, failed: 1 });
    } finally {
      setImporting(false);
      setStep('result');
    }
  }

  if (!open) return null;

  const hasBlockingErrors = errors.some(e => e.rowNumber === 0 || rowsInvalid > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Importar CSV</h2>
          <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">

          {/* Step: upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">Selecciona un archivo CSV para importar pagos.</p>
              <div
                className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center cursor-pointer hover:border-brand-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0] ?? null); }}
              >
                <p className="text-slate-400 text-sm">Arrastra un archivo aquí o haz clic para seleccionar</p>
                <p className="text-xs text-slate-300 mt-1">Solo archivos .csv · máx. 5 MB</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => handleFileSelect(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
          )}

          {/* Step: preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              {checking ? (
                <p className="text-sm text-slate-500 animate-pulse">Analizando archivo...</p>
              ) : (
                <>
                  <div className="flex gap-4 text-sm">
                    <span className="text-green-700 font-medium">{rowsValid} filas válidas</span>
                    {rowsInvalid > 0 && <span className="text-red-700 font-medium">{rowsInvalid} filas inválidas</span>}
                    {warnings.length > 0 && <span className="text-yellow-700">{warnings.length} advertencias</span>}
                  </div>

                  {errors.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-red-700"
                        onClick={() => setErrorsExpanded(e => !e)}
                      >
                        <span>{errors.length} error(es) encontrados</span>
                        <span>{errorsExpanded ? '▲' : '▼'}</span>
                      </button>
                      {errorsExpanded && (
                        <ul className="px-4 pb-3 space-y-1 max-h-40 overflow-y-auto">
                          {errors.map((e, i) => (
                            <li key={i} className="text-xs text-red-700">
                              {e.rowNumber > 0 ? `Fila ${e.rowNumber} — ` : ''}{e.field}: {e.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {previewRows.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-slate-500">#</th>
                            <th className="px-3 py-2 text-left text-slate-500">Fecha</th>
                            <th className="px-3 py-2 text-right text-slate-500">Monto</th>
                            <th className="px-3 py-2 text-left text-slate-500">Estado</th>
                            <th className="px-3 py-2 text-left text-slate-500">Referencia</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewRows.map(r => (
                            <tr key={r.rowNumber} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-400">{r.rowNumber}</td>
                              <td className="px-3 py-2">{String(r.payment_date ?? '—')}</td>
                              <td className="px-3 py-2 text-right">{String(r.amount ?? '—')}</td>
                              <td className="px-3 py-2">{String(r.status ?? '—')}</td>
                              <td className="px-3 py-2">{String(r.reference ?? '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step: progress */}
          {step === 'progress' && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-10 w-10 border-4 border-brand-600 border-t-transparent mx-auto mb-4" />
              <p className="text-sm text-slate-600">Importando registros...</p>
            </div>
          )}

          {/* Step: result */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-sm font-medium text-green-800 mb-3">Importación completada</p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-slate-500">Creados</dt><dd className="font-medium text-green-700">{result.created}</dd></div>
                  <div><dt className="text-slate-500">Actualizados</dt><dd className="font-medium text-blue-700">{result.updated}</dd></div>
                  <div><dt className="text-slate-500">Omitidos</dt><dd className="font-medium text-slate-700">{result.skipped}</dd></div>
                  <div><dt className="text-slate-500">Fallidos</dt><dd className="font-medium text-red-700">{result.failed}</dd></div>
                </dl>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
          <Button variant="secondary" onClick={handleClose}>Cerrar</Button>
          {step === 'preview' && !checking && (
            <Button
              onClick={handleImport}
              disabled={hasBlockingErrors || rowsValid === 0}
            >
              Importar {rowsValid} fila{rowsValid !== 1 ? 's' : ''}
            </Button>
          )}
          {step === 'result' && (
            <Button variant="secondary" onClick={reset}>Importar otro</Button>
          )}
        </div>
      </div>
    </div>
  );
}
