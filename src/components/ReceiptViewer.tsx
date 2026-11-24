import { useState } from 'react';
import {
  RotateCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Eye,
  XCircle,
  FileImage,
} from 'lucide-react';
import type { ExtractedImage, ManualReviewState, ReconciliationItem } from '../types';
import { formatARS } from '../lib/dateUtils';

interface ReceiptViewerProps {
  item: ReconciliationItem | null;
  imagesById: Map<string, ExtractedImage>;
  onUpdateManualState: (itemId: string, state: ManualReviewState) => void;
  onUpdateNote: (itemId: string, note: string) => void;
}

export function ReceiptViewer({
  item,
  imagesById,
  onUpdateManualState,
  onUpdateNote,
}: ReceiptViewerProps) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [activeReceiptIdx, setActiveReceiptIdx] = useState(0);

  if (!item) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        <FileImage className="mb-3 h-10 w-10 text-slate-300" />
        <p className="text-sm font-medium text-slate-700">Seleccioná una fila para inspeccionar</p>
        <p className="mt-1 text-xs text-slate-500">
          Acá vas a ver la imagen escaneada de la minuta con zoom, rotación 90° y los datos extraídos por IA.
        </p>
      </div>
    );
  }

  const safeIdx = Math.min(activeReceiptIdx, Math.max(0, item.receipts.length - 1));
  const activeReceipt = item.receipts[safeIdx] ?? null;
  const activeImage = activeReceipt ? imagesById.get(activeReceipt.imageId) : undefined;
  const sys = item.systemMovements[0] ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">
            {activeReceipt
              ? `${activeReceipt.minutaFile} · ${activeReceipt.imageName}`
              : 'Sin comprobante vinculado'}
          </h3>
          <p className="truncate text-xs text-slate-500">{item.reason}</p>
        </div>
        {activeImage && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              title="Rotar 90°"
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <RotateCw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
              title="Acercar"
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
              title="Alejar"
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setRotation(0);
                setZoom(1);
              }}
              title="Restablecer vista"
              className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Multiple receipts switcher (for 2-to-1 matches) */}
      {item.receipts.length > 1 && (
        <div className="flex gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2">
          {item.receipts.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setActiveReceiptIdx(i)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                i === safeIdx
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100'
              }`}
            >
              Comprobante {i + 1} ({formatARS(r.importe)})
            </button>
          ))}
        </div>
      )}

      {/* Duplicate alert */}
      {item.hasDuplicateAlert && (
        <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <span className="font-semibold">Alerta de duplicado: </span>
            {item.duplicateDetails || 'Imagen o comprobante repetido en las minutas.'}
          </div>
        </div>
      )}

      {/* Image Canvas */}
      <div className="relative flex-1 overflow-auto bg-slate-900/5 p-4">
        {activeImage ? (
          <div className="flex min-h-[280px] items-center justify-center">
            <img
              src={activeImage.dataUrl}
              alt={activeImage.imageName}
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
              }}
              className="max-h-[420px] rounded-lg border border-slate-200 bg-white object-contain shadow-sm transition-transform duration-150"
            />
          </div>
        ) : (
          <div className="flex h-48 flex-col items-center justify-center text-center text-slate-400">
            <FileImage className="mb-2 h-8 w-8" />
            <p className="text-xs">No hay imagen de comprobante asociada a este movimiento.</p>
          </div>
        )}
      </div>

      {/* Extracted Details & Audit Controls */}
      <div className="space-y-3 border-t border-slate-200 bg-white p-4 text-xs">
        <div className="grid grid-cols-2 gap-3">
          {/* System info */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Sistema
            </p>
            {sys ? (
              <div className="space-y-0.5 text-slate-700">
                <p className="font-semibold text-slate-900 tabular-nums">{formatARS(sys.total)}</p>
                <p>Fecha: {sys.fecha} · N° {sys.numero || '—'}</p>
                <p className="truncate" title={sys.descripcion || sys.razonSocial}>
                  {sys.descripcion || sys.razonSocial}
                </p>
                <p className="text-slate-500">
                  {sys.balance} · {sys.cajero}
                </p>
              </div>
            ) : (
              <p className="text-slate-400">No registrado en sistema</p>
            )}
          </div>

          {/* Receipt info */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Comprobante (IA)
              </p>
              {activeReceipt && (
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-indigo-700">
                  {activeReceipt.posicion}
                </span>
              )}
            </div>
            {activeReceipt ? (
              <div className="space-y-0.5 text-slate-700">
                <p className="font-semibold text-slate-900 tabular-nums">
                  {formatARS(activeReceipt.importe)}
                </p>
                <p>
                  Fecha: {activeReceipt.fecha || '—'} · N° {activeReceipt.nroComprobante || '—'}
                </p>
                <p className="truncate" title={activeReceipt.proveedorOConcepto}>
                  {activeReceipt.proveedorOConcepto}
                </p>
                <p className="text-slate-500">
                  {activeReceipt.tipoComprobante}
                  {activeReceipt.cuit ? ` · CUIT ${activeReceipt.cuit}` : ''}
                </p>
              </div>
            ) : (
              <p className="text-slate-400">Sin respaldo en minutas</p>
            )}
          </div>
        </div>

        {/* Manual Review Buttons */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-slate-600">Decisión auditor:</span>
          <div className="flex gap-1.5">
            {(
              [
                { key: 'aprobado', label: 'Aprobar', icon: CheckCircle2, active: 'bg-emerald-600 text-white' },
                { key: 'observado', label: 'Observar', icon: Eye, active: 'bg-amber-500 text-white' },
                { key: 'rechazado', label: 'Rechazar', icon: XCircle, active: 'bg-rose-600 text-white' },
              ] as const
            ).map(({ key, label, icon: Icon, active }) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onUpdateManualState(item.id, item.manualState === key ? 'pendiente' : key)
                }
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  item.manualState === key
                    ? active
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Auditor Note */}
        <div>
          <textarea
            rows={2}
            value={item.auditorNote}
            onChange={(e) => onUpdateNote(item.id, e.target.value)}
            placeholder="Agregar nota de auditoría (se incluye en el Excel exportado)..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>
    </div>
  );
}
