import { useEffect, useRef, useState } from 'react';
import {
  RotateCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  AlertTriangle,
  FileImage,
  Hand,
  ChevronLeft,
  ChevronRight,
  Unlink2,
  StickyNote,
  X,
  ArrowLeftRight,
  Link2,
  Search,
  CheckCircle2,
  ClipboardEdit,
  Check,
  ImagePlus,
  ClipboardPaste,
} from 'lucide-react';
import type { AuditStatus, ExtractedImage, ReconciliationItem } from '../types';
import { diffDaysIso, formatARS } from '../lib/dateUtils';

export interface ManualReceiptPayload {
  dataUrl: string;
  mimeType: string;
  sizeBytes: number;
  fecha: string;
  importe: string;
  nroComprobante: string;
  proveedorOConcepto: string;
  minutaFile: string;
}

const MAX_ZOOM = 5;
const DEFAULT_ZOOM = MAX_ZOOM / 2; // 2.5x — half of max zoom by default

const STATUS_OPTIONS: Array<{
  key: AuditStatus;
  label: string;
  activeClass: string;
}> = [
  { key: 'conciliado', label: '🟢 Conciliado', activeClass: 'bg-teal-600 text-white border-teal-600' },
  { key: 'validado', label: '✅ Validado', activeClass: 'bg-emerald-700 text-white border-emerald-700' },
  { key: 'revisar', label: '🟡 Revisar', activeClass: 'bg-amber-500 text-white border-amber-500' },
  { key: 'sin_respaldo', label: '🔴 Sin respaldo', activeClass: 'bg-rose-600 text-white border-rose-600' },
  { key: 'no_registrado', label: '🔵 No registrado', activeClass: 'bg-sky-600 text-white border-sky-600' },
];

interface ReceiptDetailModalProps {
  item: ReconciliationItem | null;
  allImages: ExtractedImage[];
  minutaMonthsMap: Map<string, string[]>;
  flippedMinutas: Set<string>;
  linkCandidates: ReconciliationItem[];
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChangeStatus: (itemId: string, status: AuditStatus) => void;
  onUnlink: (itemId: string) => void;
  onLinkItems: (currentItemId: string, targetItemId: string) => void;
  onAttachManualReceipt: (itemId: string, payload: ManualReceiptPayload) => void;
  onToggleFlipMinuta: (minutaFile: string) => void;
  onSaveNote: (itemId: string, note: string) => void;
  onSaveAuditField: (itemId: string, auditField: string) => void;
}

export function ReceiptDetailModal({
  item,
  allImages,
  minutaMonthsMap,
  flippedMinutas,
  linkCandidates,
  currentIndex,
  totalCount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onChangeStatus,
  onUnlink,
  onLinkItems,
  onAttachManualReceipt,
  onToggleFlipMinuta,
  onSaveNote,
  onSaveAuditField,
}: ReceiptDetailModalProps) {
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [panMode, setPanMode] = useState(true);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const [activeReceiptIdx, setActiveReceiptIdx] = useState(0);

  // Sub-modals
  const [obsModalOpen, setObsModalOpen] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<{
    dataUrl: string;
    mimeType: string;
    sizeBytes: number;
  } | null>(null);
  const [uploadFecha, setUploadFecha] = useState('');
  const [uploadImporte, setUploadImporte] = useState('');
  const [uploadNumero, setUploadNumero] = useState('');
  const [uploadProveedor, setUploadProveedor] = useState('');
  const [uploadMinuta, setUploadMinuta] = useState('Captura manual');
  const uploadFileInputRef = useRef<HTMLInputElement | null>(null);
  const [linkQuery, setLinkQuery] = useState('');
  const [draftNote, setDraftNote] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [draftAuditField, setDraftAuditField] = useState('');
  const [auditSavedFlash, setAuditSavedFlash] = useState(false);

  const readImageBlob = (blob: Blob) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadPreview({
          dataUrl: reader.result,
          mimeType: blob.type || 'image/png',
          sizeBytes: blob.size,
        });
      }
    };
    reader.readAsDataURL(blob);
  };

  const openUploadModal = (initialBlob?: Blob) => {
    const firstSys = item?.systemMovements[0];
    setUploadFecha(firstSys?.fecha ?? '');
    setUploadImporte(firstSys ? String(firstSys.total) : '');
    setUploadNumero(firstSys?.numero ?? '');
    setUploadProveedor(firstSys?.razonSocial || firstSys?.descripcion || '');
    setUploadMinuta('Captura manual');
    setUploadPreview(null);
    setUploadModalOpen(true);
    if (initialBlob) {
      readImageBlob(initialBlob);
    }
  };

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
    setDraftAuditField(item.auditField ?? '');
    setRotation(0);
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    setActiveReceiptIdx(0);
    setObsModalOpen(false);
    setAuditModalOpen(false);
    setLinkModalOpen(false);
    setUploadModalOpen(false);
    setUploadPreview(null);
    setLinkQuery('');
    setSavedFlash(false);
    setAuditSavedFlash(false);
  }, [item?.id]);

  // Clipboard Ctrl+V image paste support (inside upload modal OR directly on Sin respaldo items)
  useEffect(() => {
    if (!item) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      let imgBlob: Blob | null = null;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          imgBlob = items[i].getAsFile();
          if (imgBlob) break;
        }
      }
      if (!imgBlob) return;

      if (uploadModalOpen) {
        e.preventDefault();
        readImageBlob(imgBlob);
      } else if (
        !obsModalOpen &&
        !auditModalOpen &&
        !linkModalOpen &&
        item.systemMovements.length > 0 &&
        item.receipts.length === 0
      ) {
        e.preventDefault();
        openUploadModal(imgBlob);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, uploadModalOpen, obsModalOpen, auditModalOpen, linkModalOpen]);

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
      if (auditModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setAuditModalOpen(false);
        }
        return;
      }
      if (linkModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setLinkModalOpen(false);
        }
        return;
      }
      if (uploadModalOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setUploadModalOpen(false);
        }
        return;
      }
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
  }, [
    item,
    obsModalOpen,
    auditModalOpen,
    linkModalOpen,
    uploadModalOpen,
    onClose,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
  ]);

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
  const isValidated = item.status === 'validado';
  const canUnlink = item.systemMovements.length > 0 && item.receipts.length > 0;
  const hasNote = item.auditorNote.trim().length > 0;
  const hasAuditField = (item.auditField ?? '').trim().length > 0;

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

  const handleSaveAudit = () => {
    onSaveAuditField(item.id, draftAuditField);
    setAuditSavedFlash(true);
    setTimeout(() => {
      setAuditSavedFlash(false);
      setAuditModalOpen(false);
    }, 450);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="flex h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Compact Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-900">{title}</h2>
            <p className="truncate text-[11px] text-slate-500">{meta || item.reason}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
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
              onClick={() => onChangeStatus(item.id, isValidated ? 'conciliado' : 'validado')}
              title={isValidated ? 'Quitar validación (volver a Conciliado)' : 'Marcar como Validado por auditor'}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                isValidated
                  ? 'border-emerald-700 bg-emerald-700 text-white shadow-xs'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Validado
            </button>
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
          {/* Compact Status + Reason + Link/Unlink bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {(() => {
                const isLinked = item.systemMovements.length > 0 && item.receipts.length > 0;
                const baseStatus: AuditStatus = isLinked
                  ? 'conciliado'
                  : item.systemMovements.length > 0
                    ? 'sin_respaldo'
                    : 'no_registrado';

                return STATUS_OPTIONS.map((opt) => {
                  const isBaseActive = opt.key === baseStatus;
                  const isOverlayActive =
                    (opt.key === 'validado' && item.status === 'validado') ||
                    (opt.key === 'revisar' && item.status === 'revisar');
                  const active = isBaseActive || isOverlayActive;

                  // Incompatible link states cannot be toggled directly
                  const isIncompatible =
                    (isLinked && (opt.key === 'sin_respaldo' || opt.key === 'no_registrado')) ||
                    (!isLinked && opt.key === 'conciliado') ||
                    (!isLinked && opt.key !== baseStatus && (opt.key === 'sin_respaldo' || opt.key === 'no_registrado'));

                  const handleClick = () => {
                    if (isIncompatible) return;
                    if (opt.key === 'validado') {
                      onChangeStatus(item.id, item.status === 'validado' ? baseStatus : 'validado');
                    } else if (opt.key === 'revisar') {
                      onChangeStatus(item.id, item.status === 'revisar' ? baseStatus : 'revisar');
                    } else {
                      // Clicking base state (Conciliado / Sin respaldo / No registrado) clears Validado/Revisar
                      onChangeStatus(item.id, baseStatus);
                    }
                  };

                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={isIncompatible}
                      onClick={handleClick}
                      title={
                        isIncompatible
                          ? isLinked
                            ? 'Incompatible con Conciliado (usá Desvincular primero)'
                            : 'Incompatible sin vínculo (usá Vincular primero)'
                          : undefined
                      }
                      className={`rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition ${
                        active
                          ? opt.activeClass
                          : isIncompatible
                            ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-50'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                });
              })()}
              {sys && activeReceipt ? (
                (() => {
                  const totalRec = item.receipts.reduce((s, r) => s + (r.importe ?? 0), 0);
                  const amtDiff = Math.abs(sys.total - totalRec);
                  const amtState: 'ok' | 'warn' | 'bad' =
                    amtDiff < 0.005 ? 'ok' : amtDiff <= 0.05 ? 'warn' : 'bad';

                  const dDiff = diffDaysIso(sys.fechaIso, activeReceipt.fechaIso);
                  const dateState: 'ok' | 'warn' | 'bad' =
                    dDiff === 0 ? 'ok' : dDiff !== null && dDiff <= 2 ? 'warn' : 'bad';

                  const aNum = sys.numero.replace(/\D/g, '').replace(/^0+/, '');
                  const bNum = activeReceipt.nroComprobante.replace(/\D/g, '').replace(/^0+/, '');
                  const numMatches =
                    aNum.length >= 3 &&
                    bNum.length >= 3 &&
                    (aNum === bNum || aNum.endsWith(bNum) || bNum.endsWith(aNum));
                  const numState: 'ok' | 'warn' | 'bad' = numMatches
                    ? 'ok'
                    : aNum.length >= 4 && bNum.length >= 4
                      ? 'bad'
                      : 'warn';

                  const sysTxt = `${sys.razonSocial} ${sys.descripcion} ${sys.balance}`
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '');
                  const recTokens = activeReceipt.proveedorOConcepto
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .split(/[^a-z0-9]+/)
                    .filter((t) => t.length >= 3);
                  const provHits = recTokens.filter((t) => sysTxt.includes(t)).length;
                  const provState: 'ok' | 'bad' = provHits > 0 ? 'ok' : 'bad';

                  const pills: Array<{
                    label: string;
                    state: 'ok' | 'warn' | 'bad';
                    title: string;
                  }> = [
                    {
                      label: amtDiff >= 0.005 ? `Importe (dif. $${amtDiff.toFixed(2)})` : 'Importe',
                      state: amtState,
                      title: `Sistema: ${formatARS(sys.total)} vs Comprobante: ${formatARS(totalRec)}`,
                    },
                    {
                      label:
                        dDiff === 0
                          ? 'Fecha'
                          : dDiff !== null
                            ? `Fecha (${dDiff}d)`
                            : 'Fecha',
                      state: dateState,
                      title: `Sistema: ${sys.fecha} vs Comprobante: ${activeReceipt.fecha || '—'}`,
                    },
                    {
                      label: 'N° Comp.',
                      state: numState,
                      title: `Sistema: ${sys.numero || '—'} vs Comprobante: ${activeReceipt.nroComprobante || '—'}`,
                    },
                    {
                      label: 'Proveedor',
                      state: provState,
                      title: `Sistema: ${sys.descripcion || sys.razonSocial} vs Comprobante: ${activeReceipt.proveedorOConcepto}`,
                    },
                  ];

                  return (
                    <div className="ml-1 flex flex-wrap items-center gap-1 border-l border-slate-200 pl-2">
                      {pills.map((p) => (
                        <span
                          key={p.label}
                          title={p.title}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                            p.state === 'ok'
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                              : p.state === 'warn'
                                ? 'bg-amber-50 text-amber-800 ring-amber-200'
                                : 'bg-rose-50 text-rose-700 ring-rose-200'
                          }`}
                        >
                          {p.state === 'ok' ? (
                            <Check className="h-3 w-3 stroke-[2.5]" />
                          ) : p.state === 'bad' ? (
                            <X className="h-3 w-3 stroke-[2.5]" />
                          ) : (
                            <span className="font-bold leading-none">~</span>
                          )}
                          {p.label}
                        </span>
                      ))}
                    </div>
                  );
                })()
              ) : (
                <span className="ml-1 hidden truncate text-[11px] text-slate-500 xl:inline">
                  · {item.reason}
                </span>
              )}
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
              {!canUnlink && linkCandidates.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setLinkQuery('');
                    setLinkModalOpen(true);
                  }}
                  title={
                    sys
                      ? 'Vincular un comprobante "No registrado" a este movimiento'
                      : 'Vincular este comprobante a un movimiento "Sin respaldo"'
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {sys ? 'Vincular comprobante' : 'Vincular a sistema'}
                </button>
              )}
              {sys && !activeReceipt && (
                <button
                  type="button"
                  onClick={() => openUploadModal()}
                  title="Cargar una imagen o pegar una captura de pantalla (Ctrl + V) como respaldo"
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  Cargar comprobante
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

          {/* Multiple receipts switcher */}
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

          {/* Full-Height Scanned Image Viewer with Observation Button */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-900/5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
              {/* Left: File name + optional duplicate flip icon + Observation button */}
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

                <button
                  type="button"
                  onClick={() => {
                    setDraftNote(item.auditorNote ?? '');
                    setSavedFlash(false);
                    setObsModalOpen(true);
                  }}
                  title={hasNote ? item.auditorNote : 'Ver o editar observación de Concilens'}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    hasNote
                      ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <StickyNote className="h-3.5 w-3.5" />
                  Observación Concilens
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setDraftAuditField(item.auditField ?? '');
                    setAuditSavedFlash(false);
                    setAuditModalOpen(true);
                  }}
                  title={hasAuditField ? item.auditField : 'Cargar Observación Auditoría'}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    hasAuditField
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <ClipboardEdit className="h-3.5 w-3.5" />
                  Observación Auditoría
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

            {/* Preview Canvas */}
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
                <div className="flex flex-col items-center gap-2 text-center text-slate-400">
                  <FileImage className="h-8 w-8" />
                  <span className="text-xs">No hay imagen escaneada vinculada a este registro.</span>
                  {sys && !activeReceipt && (
                    <>
                      <span className="text-[11px] text-slate-500">
                        Podés pegar una captura de pantalla directamente con{' '}
                        <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                          Ctrl + V
                        </kbd>
                      </span>
                      <button
                        type="button"
                        onClick={() => openUploadModal()}
                        className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-xs transition hover:bg-emerald-100"
                      >
                        <ClipboardPaste className="h-3.5 w-3.5" />
                        Cargar comprobante / Pegar captura
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Observación Concilens Sub-Modal */}
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
                📝 Observación Concilens
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
                placeholder="Observación generada por Concilens…"
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
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Campo Auditoría Sub-Modal */}
      {auditModalOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setAuditModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-indigo-50/70 px-4 py-3">
              <strong className="text-xs font-bold text-indigo-950">
                ✍️ Observación Auditoría{' '}
                <span className="font-normal text-indigo-700">(carga manual del auditor)</span>
              </strong>
              <button
                type="button"
                onClick={() => setAuditModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4">
              <textarea
                rows={4}
                autoFocus
                value={draftAuditField}
                onChange={(e) => setDraftAuditField(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    handleSaveAudit();
                  }
                }}
                placeholder="Escribí una nota o hallazgo de auditoría para este registro…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-emerald-600">
                  {auditSavedFlash ? '✓ Guardado' : ''}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAuditModalOpen(false)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveAudit}
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

      {/* Manual Link Sub-Modal */}
      {linkModalOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setLinkModalOpen(false);
          }}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <h3 className="text-xs font-bold text-slate-900">
                  {sys
                    ? '🔗 Seleccionar comprobante "No registrado" para vincular'
                    : '🔗 Seleccionar movimiento "Sin respaldo" para vincular'}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Ordenados por coincidencia de N° e importe más parecido ({formatARS(sys?.total ?? activeReceipt?.importe)}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="border-b border-slate-100 p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={linkQuery}
                  onChange={(e) => setLinkQuery(e.target.value)}
                  placeholder="Buscar por monto, fecha, N°, proveedor o archivo…"
                  className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
              {(() => {
                const refAmount = sys?.total ?? activeReceipt?.importe ?? 0;
                const refNum = (sys?.numero || activeReceipt?.nroComprobante || '')
                  .replace(/\D/g, '')
                  .replace(/^0+/, '');
                const hasSameNum = (cand: ReconciliationItem) => {
                  if (refNum.length < 4) return false;
                  const cNum = (
                    cand.systemMovements[0]?.numero ||
                    cand.receipts[0]?.nroComprobante ||
                    ''
                  )
                    .replace(/\D/g, '')
                    .replace(/^0+/, '');
                  if (cNum.length < 4) return false;
                  return cNum === refNum || cNum.endsWith(refNum) || refNum.endsWith(cNum);
                };

                const q = linkQuery.trim().toLowerCase();
                const filtered = linkCandidates
                  .filter((cand) => {
                    if (!q) return true;
                    const cSys = cand.systemMovements[0];
                    const cRec = cand.receipts[0];
                    const hay = [
                      cSys?.fecha,
                      cSys?.numero,
                      cSys?.razonSocial,
                      cSys?.descripcion,
                      cSys?.total,
                      cRec?.fecha,
                      cRec?.nroComprobante,
                      cRec?.proveedorOConcepto,
                      cRec?.minutaFile,
                      cRec?.importe,
                    ]
                      .filter((v) => v !== undefined && v !== null)
                      .join(' ')
                      .toLowerCase();
                    return hay.includes(q);
                  })
                  .sort((a, b) => {
                    const numA = hasSameNum(a) ? 1 : 0;
                    const numB = hasSameNum(b) ? 1 : 0;
                    if (numA !== numB) return numB - numA;
                    const amtA = a.systemMovements[0]?.total ?? a.receipts[0]?.importe ?? 0;
                    const amtB = b.systemMovements[0]?.total ?? b.receipts[0]?.importe ?? 0;
                    return Math.abs(amtA - refAmount) - Math.abs(amtB - refAmount);
                  });

                if (filtered.length === 0) {
                  return (
                    <p className="p-6 text-center text-xs text-slate-400">
                      No hay candidatos disponibles para ese filtro.
                    </p>
                  );
                }

                return filtered.map((cand) => {
                  const cSys = cand.systemMovements[0];
                  const cRec = cand.receipts[0];
                  const amt = cSys?.total ?? cRec?.importe ?? 0;
                  const exactMatch = Math.abs(amt - refAmount) <= 0.05;
                  const numMatch = hasSameNum(cand);

                  return (
                    <button
                      key={cand.id}
                      type="button"
                      onClick={() => {
                        onLinkItems(item.id, cand.id);
                        setLinkModalOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-indigo-50/70"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-slate-900">
                            {cSys?.descripcion || cSys?.razonSocial || cRec?.proveedorOConcepto || '—'}
                          </span>
                          {numMatch && (
                            <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                              Mismo N°
                            </span>
                          )}
                          {exactMatch && (
                            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              Mismo importe
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          {cSys
                            ? `${cSys.fecha} · N° ${cSys.numero || '—'} · ${cSys.balance}`
                            : `${cRec?.fecha || '—'} · N° ${cRec?.nroComprobante || '—'} · ${cRec?.minutaFile} (${cRec?.imageName})`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-bold text-slate-900 tabular-nums">
                          {formatARS(amt)}
                        </p>
                        <span className="text-[10px] font-semibold text-indigo-600">
                          Vincular →
                        </span>
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Cargar Comprobante Manualmente (Ctrl+V / Archivo) Sub-Modal */}
      {uploadModalOpen && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setUploadModalOpen(false);
          }}
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <strong className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <ImagePlus className="h-4 w-4 text-emerald-600" />
                Cargar comprobante (Ctrl + V o archivo)
              </strong>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {/* Paste / Drop / File zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file && file.type.startsWith('image/')) {
                    readImageBlob(file);
                  }
                }}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-center transition hover:border-emerald-400"
              >
                <input
                  ref={uploadFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) readImageBlob(file);
                    e.target.value = '';
                  }}
                />
                {uploadPreview ? (
                  <div className="flex w-full flex-col items-center gap-2">
                    <img
                      src={uploadPreview.dataUrl}
                      alt="Vista previa del comprobante"
                      className="max-h-52 w-auto rounded-lg border border-slate-200 bg-white object-contain shadow-xs"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">
                        Podés pegar otra con <strong>Ctrl + V</strong> o
                      </span>
                      <button
                        type="button"
                        onClick={() => uploadFileInputRef.current?.click()}
                        className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        elegir otro archivo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 py-4">
                    <ClipboardPaste className="h-7 w-7 text-emerald-600" />
                    <p className="text-xs font-semibold text-slate-700">
                      Pegá una captura de pantalla acá con{' '}
                      <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px]">
                        Ctrl + V
                      </kbd>
                    </p>
                    <p className="text-[11px] text-slate-400">
                      También podés arrastrar una imagen o
                    </p>
                    <button
                      type="button"
                      onClick={() => uploadFileInputRef.current?.click()}
                      className="mt-0.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Seleccionar archivo de imagen
                    </button>
                  </div>
                )}
              </div>

              {/* Pre-filled editable receipt metadata */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600">Fecha</span>
                  <input
                    type="text"
                    value={uploadFecha}
                    onChange={(e) => setUploadFecha(e.target.value)}
                    placeholder="DD/MM/AAAA"
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600">Importe</span>
                  <input
                    type="text"
                    value={uploadImporte}
                    onChange={(e) => setUploadImporte(e.target.value)}
                    placeholder="0.00"
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600">N° Comprobante</span>
                  <input
                    type="text"
                    value={uploadNumero}
                    onChange={(e) => setUploadNumero(e.target.value)}
                    placeholder="N° de comprobante"
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600">Minuta / Origen</span>
                  <input
                    type="text"
                    value={uploadMinuta}
                    onChange={(e) => setUploadMinuta(e.target.value)}
                    placeholder="Ej: 30.docx o Captura manual"
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-600">Proveedor / Concepto</span>
                  <input
                    type="text"
                    value={uploadProveedor}
                    onChange={(e) => setUploadProveedor(e.target.value)}
                    placeholder="Proveedor o concepto"
                    className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!uploadPreview}
                onClick={() => {
                  if (!uploadPreview) return;
                  onAttachManualReceipt(item.id, {
                    dataUrl: uploadPreview.dataUrl,
                    mimeType: uploadPreview.mimeType,
                    sizeBytes: uploadPreview.sizeBytes,
                    fecha: uploadFecha.trim(),
                    importe: uploadImporte.trim(),
                    nroComprobante: uploadNumero.trim(),
                    proveedorOConcepto: uploadProveedor.trim(),
                    minutaFile: uploadMinuta.trim() || 'Captura manual',
                  });
                  setUploadModalOpen(false);
                  setUploadPreview(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                Guardar y Conciliar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
