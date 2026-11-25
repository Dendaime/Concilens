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
  Check,
  StickyNote,
  X,
  ArrowLeftRight,
} from 'lucide-react';
import type { AuditCategory, AuditStatus, ExtractedImage, ReconciliationItem } from '../types';
import { formatARS } from '../lib/dateUtils';

const MAX_ZOOM = 5;
const DEFAULT_ZOOM = MAX_ZOOM / 2; // 2.5x — half of max zoom by default

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
  allImages: ExtractedImage[];
  minutaMonthsMap: Map<string, string[]>;
  flippedMinutas: Set<string>;
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
  onToggleFlipMinuta: (minutaFile: string) => void;
  onSaveNote: (itemId: string, note: string) => void;
  onToggleCategory: (itemId: string, categoryId: string) => void;
  onOpenCategoryManager: () => void;
}

export function ReceiptDetailModal({
  item,
  allImages,
  minutaMonthsMap,
  flippedMinutas,
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
  onToggleFlipMinuta,
  onSaveNote,
  onToggleCategory,
  onOpenCategoryManager,
}: ReceiptDetailModalProps) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [panMode, setPanMode] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const [activeReceiptIdx, setActiveReceiptIdx] = useState(0);

  // Compact toolbar popovers / sub-modal
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const [obsModalOpen, setObsModalOpen] = useState(false);
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

  // Non-passive wheel listener on the image preview ONLY so wheel zooms without scrolling page
  useEffect(() => {
    const el = previewViewportRef.current;
    if (!el || !item) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      setZoom((z) => Math.min(MAX_ZOOM, Math.max(0.5, +(z + delta).toFixed(2))));
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [item?.id, activeReceiptIdx]);

  // Reset view when switching to another record
  useEffect(() => {
    if (!item) return;
    setDraftNote(item.auditorNote ?? '');
    setRotation(0);
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    setActiveReceiptIdx(0);
    setCatDropdownOpen(false);
    setObsModalOpen(false);
    setSavedFlash(false);
  }, [item?.id]);

  // Keyboard navigation (← / → / Enter / Escape)
  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (obsModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setObsModalOpen(false);
        }
        return;
      }
      if (e.key === 'Escape') {
        if (catDropdownOpen) {
          setCatDropdownOpen(false);
        } else {
          onClose();
        }
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
  }, [item, obsModalOpen, catDropdownOpen, onClose, hasPrev, hasNext, onPrev, onNext]);

  if (!item) return null;

  const safeIdx = Math.min(activeReceiptIdx, Math.max(0, item.receipts.length - 1));
  const activeReceipt = item.receipts[safeIdx] ?? null;

  // Automatically resolve image, disambiguating duplicate legacy filenames chronologically by month
  let activeImage: ExtractedImage | undefined;
  let hasDuplicateCopy = false;
  if (activeReceipt) {
    if (
      typeof activeReceipt.resolvedImageIndex === 'number' &&
      allImages[activeReceipt.resolvedImageIndex]
    ) {
      activeImage = allImages[activeReceipt.resolvedImageIndex];
    } else {
      const idMatches = allImages.filter((img) => img.id === activeReceipt.imageId);
      if (idMatches.length === 1) {
        activeImage = idMatches[0];
      } else if (idMatches.length > 1) {
        hasDuplicateCopy = true;
        const key = activeReceipt.minutaFile.toLowerCase();
        const months = minutaMonthsMap.get(key) ?? [];
        const recMonth = activeReceipt.fechaIso?.slice(0, 7) ?? '';
        const monthIdx = recMonth ? months.indexOf(recMonth) : -1;
        let pickIdx = monthIdx >= 0 ? Math.min(monthIdx, idMatches.length - 1) : 0;
        if (flippedMinutas.has(key)) {
          pickIdx = idMatches.length - 1 - pickIdx;
        }
        activeImage = idMatches[pickIdx];
      }
    }
  }

  const sys = item.systemMovements[0] ?? null;
  const assignedIds = new Set(item.categoryIds ?? []);
  const assignedCats = categories.filter((c) => assignedIds.has(c.id));
  const canUnlink = item.systemMovements.length > 0 && item.receipts.length > 0;
  const hasNote = item.auditorNote.trim().length > 0;

  const title =
    sys?.descripcion || sys?.razonSocial || activeReceipt?.proveedorOConcepto || 'Detalle de comprobante';
  const meta = [
    sys?.fecha || activeReceipt?.fecha || null,
    sys?.numero
      ? `N° ${sys.numero}`
      : activeReceipt?.nroComprobante
        ? `N° ${activeReceipt.nroComprobante}`
        : null,
    sys?.cajero ? `Cajero ${sys.cajero}` : null,
    sys?.balance || null,
  ]
    .filter(Boolean)
    .join(' · ');

  const handleSaveObs = () => {
    onSaveNote(item.id, draftNote);
    setSavedFlash(true);
    setTimeout(() => {
      setSavedFlash(false);
      setObsModalOpen(false);
    }, 450);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => {
          e.stopPropagation();
          if (catDropdownOpen) setCatDropdownOpen(false);
        }}
      >
        {/* Compact Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-900">{title}</h2>
            <p className="truncate text-[11px] text-slate-500">{meta || item.reason}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
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
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cerrar
            </button>
          </div>
        </div>

        {/* All-at-a-glance Body (no scrolling needed) */}
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3.5 text-xs">
          {/* Compact Status + Reason + Unlink bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_OPTIONS.map((opt) => {
                const active = item.status === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onChangeStatus(item.id, opt.key)}
                    className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                      active
                        ? opt.activeClass
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
              <span className="ml-1 hidden truncate text-[11px] text-slate-500 xl:inline">
                · {item.reason}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {item.hasDuplicateAlert && (
                <span
                  title={item.duplicateDetails || 'Posible duplicado'}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                  Duplicado
                </span>
              )}
              {canUnlink && (
                <button
                  type="button"
                  onClick={() => onUnlink(item.id)}
                  title="Separar este cruce en 'Sin respaldo' + 'No registrado'"
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-100"
                >
                  <Unlink2 className="h-3.5 w-3.5" />
                  Desvincular
                </button>
              )}
            </div>
          </div>

          {/* Compact Side-by-side System vs Receipt */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Sistema
                </span>
                {sys && (
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    {formatARS(sys.total)}
                  </span>
                )}
              </div>
              {sys ? (
                <div className="mt-0.5 space-y-0.5 text-[11px] text-slate-700">
                  <p className="truncate">
                    <strong>{sys.fecha}</strong> · N° <strong>{sys.numero || '—'}</strong> ·{' '}
                    {sys.razonSocial}
                  </p>
                  <p className="truncate text-slate-500">
                    {sys.descripcion ? `${sys.descripcion} · ` : ''}Caja {sys.caja} · {sys.balance}
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">No registrado en el sistema.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Comprobante
                  </span>
                  {activeReceipt && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.2 text-[10px] font-semibold uppercase text-indigo-700">
                      {activeReceipt.posicion}
                    </span>
                  )}
                </div>
                {activeReceipt && (
                  <span className="text-sm font-bold text-slate-900 tabular-nums">
                    {formatARS(activeReceipt.importe)}
                  </span>
                )}
              </div>
              {activeReceipt ? (
                <div className="mt-0.5 space-y-0.5 text-[11px] text-slate-700">
                  <p className="truncate">
                    <strong>{activeReceipt.fecha || '—'}</strong> · N°{' '}
                    <strong>{activeReceipt.nroComprobante || '—'}</strong> ·{' '}
                    {activeReceipt.proveedorOConcepto}
                  </p>
                  <p className="truncate text-slate-500">
                    {activeReceipt.tipoComprobante}
                    {activeReceipt.cuit ? ` · CUIT ${activeReceipt.cuit}` : ''} ·{' '}
                    {activeReceipt.minutaFile} ({activeReceipt.imageName})
                  </p>
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">Sin comprobante en minutas.</p>
              )}
            </div>
          </div>

          {/* Multiple receipts switcher (only when 2+ receipts matched) */}
          {item.receipts.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {item.receipts.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveReceiptIdx(i)}
                  className={`rounded-lg px-2.5 py-0.5 text-[11px] font-medium ${
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

          {/* Full-Height Scanned Image Viewer with Categories Dropdown + Observation Button */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-900/5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
              {/* Left: File name + optional duplicate flip icon + Categories dropdown + Observation button */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">
                  {activeImage
                    ? `${activeImage.minutaFile} · ${activeImage.imageName}`
                    : 'Sin imagen vinculada'}
                </span>

                {hasDuplicateCopy && activeReceipt && (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleFlipMinuta(activeReceipt.minutaFile);
                      setPan({ x: 0, y: 0 });
                    }}
                    title="Alternar copia de minuta repetida"
                    className="rounded-lg border border-slate-200 bg-slate-50 p-1 text-slate-600 transition hover:bg-slate-100 hover:text-indigo-600"
                  >
                    <ArrowLeftRight className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Categories Dropdown */}
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setCatDropdownOpen((v) => !v)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                      assignedCats.length > 0
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Tag className="h-3.5 w-3.5" />
                    {assignedCats.length === 0
                      ? 'Categorías ▾'
                      : assignedCats.length === 1
                        ? `${assignedCats[0].name} ▾`
                        : `Categorías (${assignedCats.length}) ▾`}
                  </button>

                  {catDropdownOpen && (
                    <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-xl">
                      {categories.length === 0 ? (
                        <p className="px-2.5 py-1.5 text-[11px] text-slate-400">
                          No hay categorías creadas.
                        </p>
                      ) : (
                        categories.map((cat) => {
                          const checked = assignedIds.has(cat.id);
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => {
                                onToggleCategory(item.id, cat.id);
                                setCatDropdownOpen(false);
                              }}
                              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100"
                            >
                              <span className="flex items-center gap-2 truncate">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: cat.color }}
                                />
                                <span className="truncate font-medium text-slate-800">
                                  {cat.name}
                                </span>
                              </span>
                              {checked && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
                            </button>
                          );
                        })
                      )}
                      <div className="my-1 border-t border-slate-100" />
                      <button
                        type="button"
                        onClick={() => {
                          setCatDropdownOpen(false);
                          onOpenCategoryManager();
                        }}
                        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left font-medium text-indigo-600 hover:bg-indigo-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Administrar categorías…
                      </button>
                    </div>
                  )}
                </div>

                {/* Observation Sub-Modal Button */}
                <button
                  type="button"
                  onClick={() => {
                    setDraftNote(item.auditorNote ?? '');
                    setSavedFlash(false);
                    setObsModalOpen(true);
                  }}
                  title={hasNote ? item.auditorNote : 'Agregar observación de auditoría'}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    hasNote
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <StickyNote className="h-3.5 w-3.5" />
                  {hasNote ? 'Ver / Editar obs.' : 'Observación'}
                </button>
              </div>

              {/* Right: Hand + Rotate + Zoom controls */}
              {activeImage && (
                <div className="flex items-center gap-1">
                  <span className="mr-1 text-[11px] font-medium text-slate-400 tabular-nums">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setPanMode((v) => !v)}
                    title={
                      panMode
                        ? 'Herramienta de mano activa (arrastrá para mover)'
                        : 'Activar herramienta de mano'
                    }
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
                    onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.35).toFixed(2)))}
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
                      setZoom(DEFAULT_ZOOM);
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

            {/* Preview Canvas occupying all remaining vertical height */}
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
              className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 select-none ${
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
                  className={`max-h-full max-w-full rounded-lg border border-slate-200 bg-white object-contain shadow-sm ${
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
        </div>
      </div>

      {/* Observation Sub-Modal */}
      {obsModalOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setObsModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <strong className="text-xs font-bold text-slate-900">
                📝 Observación auditoría{' '}
                <span className="font-normal text-slate-500">(solo Concilens)</span>
              </strong>
              <button
                type="button"
                onClick={() => setObsModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                rows={4}
                autoFocus
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveObs();
                  }
                }}
                placeholder="Escribí una observación de auditoría para este registro…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-emerald-600">
                  {savedFlash ? '✓ Guardado' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setObsModalOpen(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
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
      )}
    </div>
  );
}
