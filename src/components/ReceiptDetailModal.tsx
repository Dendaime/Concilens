import { useEffect, useRef, useState } from 'react';
import {
  RotateCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AlertTriangle,
  FileImage,
  Tag,
  Plus,
  Hand,
  ChevronLeft,
  ChevronRight,
  Unlink2,
} from 'lucide-react';
import type { AuditCategory, AuditStatus, ExtractedImage, ReconciliationItem } from '../types';
import { formatARS } from '../lib/dateUtils';

const STATUS_OPTIONS: Array<{
  key: AuditStatus;
  label: string;
  activeClass: string;
}> = [
  { key: 'conciliado', label: '🟢 Conciliado', activeClass: 'bg-emerald-600 text-white border-emerald-600' },
  { key: 'revisar', label: '🟡 Revisar', activeClass: 'bg-amber-500 text-white border-amber-500' },
  { key: 'sin_respaldo', label: '🔴 Sin respaldo', activeClass: 'bg-rose-600 text-white border-rose-600' },
  { key: 'no_registrado', label: '🔵 No registrado', activeClass: 'bg-sky-600 text-white border-sky-600' },
];

interface ReceiptDetailModalProps {
  item: ReconciliationItem | null;
  imagesById: Map<string, ExtractedImage>;
  allImages: ExtractedImage[];
  categories: AuditCategory[];
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChangeStatus: (itemId: string, status: AuditStatus) => void;
  onUnlink: (itemId: string) => void;
  onSaveNote: (itemId: string, note: string) => void;
  onToggleCategory: (itemId: string, categoryId: string) => void;
  onOpenCategoryManager: () => void;
}

export function ReceiptDetailModal({
  item,
  imagesById,
  allImages,
  categories,
  currentIndex,
  totalCount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onChangeStatus,
  onUnlink,
  onSaveNote,
  onToggleCategory,
  onOpenCategoryManager,
}: ReceiptDetailModalProps) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const modalBodyRef = useRef<HTMLDivElement | null>(null);
  const [activeReceiptIdx, setActiveReceiptIdx] = useState(0);
  const [manualImageId, setManualImageId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  // Lock background page scroll while modal is open
  useEffect(() => {
    if (!item) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [Boolean(item)]);

  // Non-passive wheel listener on the image preview ONLY so wheel zooms without scrolling modal/page
  useEffect(() => {
    const el = previewViewportRef.current;
    if (!el || !item) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      setZoom((z) => Math.min(5, Math.max(0.5, +(z + delta).toFixed(2))));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [item?.id, activeReceiptIdx, manualImageId]);

  useEffect(() => {
    if (!item) return;
    setDraftNote(item.auditorNote ?? '');
    setRotation(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    setActiveReceiptIdx(0);
    setManualImageId(null);
    setSavedFlash(false);
  }, [item?.id]);

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if ((e.key === 'ArrowRight' || e.key === 'Enter') && hasNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [item, onClose, hasPrev, hasNext, onPrev, onNext]);

  if (!item) return null;

  const safeIdx = Math.min(activeReceiptIdx, Math.max(0, item.receipts.length - 1));
  const activeReceipt = item.receipts[safeIdx] ?? null;
  const activeImage = manualImageId
    ? imagesById.get(manualImageId)
    : activeReceipt
      ? imagesById.get(activeReceipt.imageId)
      : undefined;
  const sys = item.systemMovements[0] ?? null;
  const assignedIds = new Set(item.categoryIds ?? []);
  const canUnlink = item.systemMovements.length > 0 && item.receipts.length > 0;
  const sameMinutaImages = activeReceipt
    ? allImages.filter((img) => img.minutaFile === activeReceipt.minutaFile)
    : [];
  const sheetOptions = sameMinutaImages.length > 1 ? sameMinutaImages : allImages;

  const title =
    sys?.descripcion || sys?.razonSocial || activeReceipt?.proveedorOConcepto || 'Detalle de comprobante';
  const meta = [
    sys?.fecha || activeReceipt?.fecha || null,
    sys?.numero ? `N° ${sys.numero}` : activeReceipt?.nroComprobante ? `N° ${activeReceipt.nroComprobante}` : null,
    sys?.cajero ? `Cajero ${sys.cajero}` : null,
    sys?.balance || null,
  ]
    .filter(Boolean)
    .join(' · ');

  const handleSaveObs = () => {
    onSaveNote(item.id, draftNote);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      onClick={onClose}
      onWheel={(e) => {
        if (e.target === e.currentTarget && modalBodyRef.current) {
          modalBodyRef.current.scrollTop += e.deltaY;
        }
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (Hotelito style + Prev/Next navigation) */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-slate-900">{title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{meta || item.reason}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {totalCount > 1 && currentIndex >= 0 && (
              <div className="mr-1 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
                <button
                  type="button"
                  disabled={!hasPrev}
                  onClick={onPrev}
                  title="Movimiento anterior (←)"
                  className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1 text-[11px] font-semibold text-slate-600 tabular-nums">
                  {currentIndex + 1} / {totalCount}
                </span>
                <button
                  type="button"
                  disabled={!hasNext}
                  onClick={onNext}
                  title="Movimiento siguiente (→ o Enter)"
                  className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div ref={modalBodyRef} className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          {/* Status Switcher & Unlink */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-700">Estado:</span>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((opt) => {
                  const active = item.status === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => onChangeStatus(item.id, opt.key)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                        active
                          ? opt.activeClass
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {canUnlink && (
              <button
                type="button"
                onClick={() => onUnlink(item.id)}
                title="Separar este cruce en 'Sin respaldo' + 'No registrado'"
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
              >
                <Unlink2 className="h-3.5 w-3.5" />
                Desvincular cruce
              </button>
            )}
          </div>

          <div className="rounded-xl border border-sky-200 bg-sky-50/70 px-3.5 py-2.5 text-sky-900">
            <span className="font-semibold">Resultado del cruce: </span>
            {item.reason}
          </div>

          {item.hasDuplicateAlert && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <span className="font-semibold">Alerta de duplicado: </span>
                {item.duplicateDetails || 'Imagen o comprobante repetido en las minutas.'}
              </div>
            </div>
          )}

          {/* Side-by-side System vs Receipt */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Registro del Sistema
              </p>
              {sys ? (
                <div className="space-y-1 text-slate-700">
                  <p className="text-base font-bold text-slate-900 tabular-nums">
                    {formatARS(sys.total)}
                  </p>
                  <p>
                    Fecha: <strong>{sys.fecha}</strong> · N° <strong>{sys.numero || '—'}</strong>
                  </p>
                  <p>{sys.razonSocial}</p>
                  {sys.descripcion && <p className="text-slate-600">{sys.descripcion}</p>}
                  <p className="text-slate-500">
                    Caja {sys.caja} · {sys.cajero} · {sys.balance}
                  </p>
                </div>
              ) : (
                <p className="text-slate-400">No registrado en el listado del sistema.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Comprobante en Minuta
                </p>
                {activeReceipt && (
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-indigo-700">
                    {activeReceipt.posicion}
                  </span>
                )}
              </div>
              {activeReceipt ? (
                <div className="space-y-1 text-slate-700">
                  <p className="text-base font-bold text-slate-900 tabular-nums">
                    {formatARS(activeReceipt.importe)}
                  </p>
                  <p>
                    Fecha: <strong>{activeReceipt.fecha || '—'}</strong> · N°{' '}
                    <strong>{activeReceipt.nroComprobante || '—'}</strong>
                  </p>
                  <p>{activeReceipt.proveedorOConcepto}</p>
                  <p className="text-slate-500">
                    {activeReceipt.tipoComprobante}
                    {activeReceipt.cuit ? ` · CUIT ${activeReceipt.cuit}` : ''}
                  </p>
                  <p className="text-slate-500">
                    {activeReceipt.minutaFile} ({activeReceipt.imageName})
                  </p>
                </div>
              ) : (
                <p className="text-slate-400">Sin comprobante vinculado en las minutas.</p>
              )}
            </div>
          </div>

          {/* Multiple receipts switcher */}
          {item.receipts.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {item.receipts.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveReceiptIdx(i)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium ${
                    i === safeIdx
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  Comprobante {i + 1} ({formatARS(r.importe)})
                </button>
              ))}
            </div>
          )}

          {/* Scanned Image Viewer */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900/5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">
                  {activeImage
                    ? `${activeImage.minutaFile} · ${activeImage.imageName}`
                    : 'Imagen del comprobante'}
                </span>
                {sheetOptions.length > 1 && (
                  <select
                    value={activeImage?.id ?? ''}
                    onChange={(e) => {
                      setManualImageId(e.target.value || null);
                      setPan({ x: 0, y: 0 });
                    }}
                    title="Cambiar hoja previsualizada"
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 focus:border-indigo-500 focus:outline-none"
                  >
                    {!activeImage && <option value="">Elegir hoja…</option>}
                    {sheetOptions.map((img, idx) => (
                      <option key={img.id} value={img.id}>
                        {sameMinutaImages.length > 1
                          ? `Hoja ${idx + 1} (${img.imageName})`
                          : `${img.minutaFile} · ${img.imageName}`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {activeImage && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPanMode((v) => !v)}
                    title={panMode ? 'Herramienta de mano activa (arrastrá para mover)' : 'Activar herramienta de mano'}
                    className={`rounded-lg border p-1.5 transition ${
                      panMode
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Hand className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    title="Rotar 90°"
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.min(4, +(z + 0.35).toFixed(2)))}
                    title="Acercar"
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.35).toFixed(2)))}
                    title="Alejar"
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRotation(0);
                      setZoom(1);
                      setPan({ x: 0, y: 0 });
                    }}
                    title="Restablecer vista"
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
            <div
              ref={previewViewportRef}
              onPointerDown={(e) => {
                if (!panMode || !activeImage || e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                setIsDragging(true);
                dragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  panX: pan.x,
                  panY: pan.y,
                };
              }}
              onPointerMove={(e) => {
                if (!isDragging || !dragStartRef.current) return;
                const dx = e.clientX - dragStartRef.current.x;
                const dy = e.clientY - dragStartRef.current.y;
                setPan({
                  x: dragStartRef.current.panX + dx,
                  y: dragStartRef.current.panY + dy,
                });
              }}
              onPointerUp={() => {
                setIsDragging(false);
                dragStartRef.current = null;
              }}
              onPointerCancel={() => {
                setIsDragging(false);
                dragStartRef.current = null;
              }}
              className={`flex h-[380px] items-center justify-center overflow-hidden p-4 select-none ${
                panMode && activeImage
                  ? isDragging
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                  : 'overflow-auto'
              }`}
            >
              {activeImage ? (
                <img
                  src={activeImage.dataUrl}
                  alt={activeImage.imageName}
                  draggable={false}
                  style={{
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin: 'center center',
                  }}
                  className={`max-h-[340px] rounded-lg border border-slate-200 bg-white object-contain shadow-sm ${
                    isDragging ? '' : 'transition-transform duration-150'
                  }`}
                />
              ) : (
                <div className="flex flex-col items-center text-slate-400">
                  <FileImage className="mb-1.5 h-8 w-8" />
                  <span>No hay imagen escaneada vinculada a este registro.</span>
                </div>
              )}
            </div>
          </div>

          {/* Categorization Pills */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                <Tag className="h-3.5 w-3.5 text-indigo-600" />
                Categorías de auditoría
              </span>
              <button
                type="button"
                onClick={onOpenCategoryManager}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-100"
              >
                <Plus className="h-3 w-3" />
                Administrar
              </button>
            </div>
            {categories.length === 0 ? (
              <p className="text-slate-400">
                Todavía no hay categorías creadas. Hacé clic en <strong>Administrar</strong> para crear una.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => {
                  const active = assignedIds.has(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => onToggleCategory(item.id, cat.id)}
                      style={
                        active
                          ? { backgroundColor: cat.color, borderColor: cat.color, color: '#ffffff' }
                          : { borderColor: `${cat.color}66`, color: cat.color, backgroundColor: '#ffffff' }
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-90"
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: active ? '#ffffff' : cat.color }}
                      />
                      {cat.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hotelito-style Observación de auditoría box */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-xs text-slate-800">
                📝 Observación auditoría{' '}
                <span className="font-normal text-slate-500">(solo Concilens)</span>
              </strong>
              {savedFlash && (
                <span className="text-[11px] font-bold text-emerald-600">✓ Guardado</span>
              )}
            </div>
            <textarea
              rows={3}
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="Escribí una observación de auditoría para este registro…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <div className="mt-2 grid grid-cols-3 items-center gap-2">
              <div />
              <div className="flex justify-center">
                {totalCount > 1 && currentIndex >= 0 && (
                  <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
                    <button
                      type="button"
                      disabled={!hasPrev}
                      onClick={onPrev}
                      title="Movimiento anterior (←)"
                      className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="px-1 text-[11px] font-semibold text-slate-600 tabular-nums">
                      {currentIndex + 1} / {totalCount}
                    </span>
                    <button
                      type="button"
                      disabled={!hasNext}
                      onClick={onNext}
                      title="Movimiento siguiente (→ o Enter)"
                      className="rounded-md p-1 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveObs}
                  className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Guardar observación
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
