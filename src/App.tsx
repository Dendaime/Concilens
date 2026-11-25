import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Sparkles,
  Download,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Clock,
  XCircle,
  HelpCircle,
  Search,
  ChevronDown,
  ChevronUp,
  Play,
  Copy,
  Check,
  MessageSquare,
  Save,
  FolderOpen,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import type {
  AuditStatus,
  ExtractedImage,
  ExtractedReceipt,
  LegacyAuditCategory,
  ReconciliationItem,
  SystemMovement,
} from './types';
import { parseSystemExcel } from './lib/excelParser';
import { extractImagesFromDocxFiles } from './lib/docxParser';
import { extractDocxFromMixedFiles } from './lib/emailExtractor';
import { GEMINI_CHAT_PROMPT, parseManualGeminiJson } from './lib/manualJsonParser';
import { exportImagesToPdfForGemini } from './lib/pdfExporter';
import { reconcileMovementsAndReceipts } from './lib/reconcile';
import { exportAuditToExcel } from './lib/exportExcel';
import { formatARS } from './lib/dateUtils';
import { buildDemoData } from './lib/demoData';
import {
  clearSessionInDb,
  downloadSessionBackup,
  loadSessionFromDb,
  readSessionBackupFile,
  saveSessionToDb,
  type SavedSession,
} from './lib/storage';
import { ReceiptDetailModal } from './components/ReceiptDetailModal';

type FilterTab = 'excepciones' | 'todos' | AuditStatus | 'duplicados';
type ColumnKey =
  | 'estado'
  | 'fecha'
  | 'numero'
  | 'proveedor'
  | 'importe'
  | 'minuta'
  | 'observacion'
  | 'auditoria';

const COLUMN_DEFS: Array<{ key: ColumnKey; label: string; alignRight?: boolean }> = [
  { key: 'estado', label: 'Estado' },
  { key: 'fecha', label: 'Fecha' },
  { key: 'numero', label: 'N° Comp.' },
  { key: 'proveedor', label: 'Proveedor / Concepto' },
  { key: 'importe', label: 'Importe', alignRight: true },
  { key: 'minuta', label: 'Minuta' },
  { key: 'observacion', label: 'Obs. Concilens' },
  { key: 'auditoria', label: 'Campo Auditoría' },
];

const STATUS_META: Record<
  AuditStatus,
  { label: string; badgeClass: string; icon: typeof CheckCircle2 }
> = {
  validado: {
    label: 'Validado',
    badgeClass: 'bg-emerald-600 text-white ring-1 ring-emerald-700',
    icon: ShieldCheck,
  },
  conciliado: {
    label: 'Conciliado',
    badgeClass: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
    icon: CheckCircle2,
  },
  revisar: {
    label: 'Revisar',
    badgeClass: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
    icon: Clock,
  },
  sin_respaldo: {
    label: 'Sin respaldo',
    badgeClass: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    icon: XCircle,
  },
  no_registrado: {
    label: 'No registrado',
    badgeClass: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
    icon: HelpCircle,
  },
};

/**
 * Lossless migration from legacy categoryIds to the unified 5-state workflow:
 * - Category matching "valid*" or "revisado ok" -> status = 'validado'
 * - Category matching "observ*" -> status = 'revisar'
 */
function migrateLegacyItems(
  rawItems: ReconciliationItem[],
  legacyCategories?: LegacyAuditCategory[]
): ReconciliationItem[] {
  const catNamesById = new Map<string, string>();
  for (const c of legacyCategories ?? []) {
    const norm = c.name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    catNamesById.set(c.id, norm);
  }

  return rawItems.map((it) => {
    const catIds = Array.isArray(it.categoryIds) ? it.categoryIds : [];
    let nextStatus: AuditStatus = it.status;

    if (catIds.length > 0) {
      const names = catIds.map((id) => catNamesById.get(id) ?? id.toLowerCase());
      const isValidated = names.some(
        (n) => n.includes('valid') || n.includes('revisado ok') || n === 'cat-ok'
      );
      const isObserved = names.some((n) => n.includes('observ') || n === 'cat-obs');
      if (isValidated) {
        nextStatus = 'validado';
      } else if (isObserved) {
        nextStatus = 'revisar';
      }
    }

    return {
      ...it,
      status: nextStatus,
      categoryIds: [],
    };
  });
}

export default function App() {
  // Config & Chat JSON
  const [pastedJson, setPastedJson] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [dateToleranceDays, setDateToleranceDays] = useState(2);

  // Loaded inputs
  const [systemFileName, setSystemFileName] = useState<string | null>(null);
  const [allMovements, setAllMovements] = useState<SystemMovement[]>([]);
  const [cajeros, setCajeros] = useState<string[]>([]);
  const [selectedCajero, setSelectedCajero] = useState<string>('TODOS');

  const [docxFileNames, setDocxFileNames] = useState<string[]>([]);
  const [extractedImages, setExtractedImages] = useState<ExtractedImage[]>([]);
  const [extractedReceipts, setExtractedReceipts] = useState<ExtractedReceipt[]>([]);

  // Results
  const [items, setItems] = useState<ReconciliationItem[]>([]);

  // Detail modal, column filters & right-click / long-press context menu
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [modalNavIds, setModalNavIds] = useState<string[]>([]);
  const [flippedMinutas, setFlippedMinutas] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('concilens_flipped_minutas');
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set<string>();
    }
  });
  const [ctxMenu, setCtxMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);
  const [colFilters, setColFilters] = useState<Record<ColumnKey, string>>({
    estado: '',
    fecha: '',
    numero: '',
    proveedor: '',
    importe: '',
    minuta: '',
    observacion: '',
    auditoria: '',
  });
  const [colSelectedValues, setColSelectedValues] = useState<Record<ColumnKey, string[]>>({
    estado: [],
    fecha: [],
    numero: [],
    proveedor: [],
    importe: [],
    minuta: [],
    observacion: [],
    auditoria: [],
  });
  const [openColFilter, setOpenColFilter] = useState<ColumnKey | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const [activeTab, setActiveTab] = useState<FilterTab>('excepciones');
  const [searchQuery, setSearchQuery] = useState('');
  const [setupExpanded, setSetupExpanded] = useState(true);

  // Persistence & feedback
  const [hydrated, setHydrated] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  // Close context menu / popovers on outside click
  useEffect(() => {
    const closeMenus = () => {
      setCtxMenu(null);
      setOpenColFilter(null);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  // Restore saved session from IndexedDB on mount (with automatic legacy category migration)
  useEffect(() => {
    let active = true;
    loadSessionFromDb()
      .then((saved) => {
        if (!active || !saved) return;
        setSystemFileName(saved.systemFileName);
        setAllMovements(saved.allMovements);
        setCajeros(saved.cajeros);
        setSelectedCajero(saved.selectedCajero);
        setDocxFileNames(saved.docxFileNames);
        setExtractedImages(saved.extractedImages);
        setExtractedReceipts(saved.extractedReceipts);
        setPastedJson(saved.pastedJson);
        setDateToleranceDays(saved.dateToleranceDays);
        setItems(migrateLegacyItems(saved.items, saved.categories));
        setLastSavedAt(saved.savedAt);
        if (saved.items.length > 0) setSetupExpanded(false);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const buildCurrentSession = (): SavedSession => ({
    version: 1,
    savedAt: new Date().toISOString(),
    systemFileName,
    allMovements,
    cajeros,
    selectedCajero,
    docxFileNames,
    extractedImages,
    extractedReceipts,
    pastedJson,
    dateToleranceDays,
    items,
  });

  // Auto-save to IndexedDB whenever work changes (debounced)
  useEffect(() => {
    if (!hydrated) return;
    const hasData =
      allMovements.length > 0 ||
      extractedImages.length > 0 ||
      pastedJson.trim().length > 0 ||
      items.length > 0;
    if (!hasData) return;

    const timer = setTimeout(() => {
      const session = buildCurrentSession();
      saveSessionToDb(session)
        .then(() => setLastSavedAt(session.savedAt))
        .catch(() => {});
    }, 500);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hydrated,
    systemFileName,
    allMovements,
    cajeros,
    selectedCajero,
    docxFileNames,
    extractedImages,
    extractedReceipts,
    pastedJson,
    dateToleranceDays,
    items,
  ]);

  const minutaMonthsMap = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    for (const it of items) {
      for (const r of it.receipts) {
        const month = r.fechaIso?.slice(0, 7);
        if (!month) continue;
        const key = r.minutaFile.toLowerCase();
        const s = sets.get(key) ?? new Set<string>();
        s.add(month);
        sets.set(key, s);
      }
    }
    const result = new Map<string, string[]>();
    for (const [k, s] of sets.entries()) {
      result.set(k, Array.from(s).sort());
    }
    return result;
  }, [items]);

  const filteredMovements = useMemo(() => {
    if (selectedCajero === 'TODOS') return allMovements;
    return allMovements.filter((m) => m.cajero === selectedCajero);
  }, [allMovements, selectedCajero]);

  const duplicateImagesCount = useMemo(
    () => extractedImages.filter((i) => Boolean(i.duplicateOf)).length,
    [extractedImages]
  );

  const handleExcelUpload = async (file: File) => {
    setErrorMsg(null);
    try {
      const parsed = await parseSystemExcel(file);
      setSystemFileName(file.name);
      setAllMovements(parsed.movements);
      setCajeros(parsed.cajeros);
      if (parsed.cajeros.length === 1) {
        setSelectedCajero(parsed.cajeros[0]);
      } else {
        setSelectedCajero('TODOS');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al leer el archivo Excel/CSV.');
    }
  };

  const handleDocxUpload = async (files: FileList | File[]) => {
    setErrorMsg(null);
    try {
      const { docxFiles, emailsProcessed } = await extractDocxFromMixedFiles(files);
      if (docxFiles.length === 0) {
        setErrorMsg(
          emailsProcessed > 0
            ? `Se revisaron ${emailsProcessed} correos (.msg/.eml), pero no contenían adjuntos .docx.`
            : 'Seleccioná archivos .docx o correos .msg / .eml de Outlook con minutas adjuntas.'
        );
        return;
      }
      const imgs = await extractImagesFromDocxFiles(docxFiles);
      setDocxFileNames(docxFiles.map((f) => f.name));
      setExtractedImages(imgs);
      setExtractedReceipts([]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Error al procesar los archivos .docx / .msg / .eml.'
      );
    }
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(GEMINI_CHAT_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2500);
    } catch {
      setErrorMsg('No se pudo copiar al portapapeles automáticamente.');
    }
  };

  const handleRunReconciliation = () => {
    setErrorMsg(null);
    if (filteredMovements.length === 0) {
      setErrorMsg('Primero cargá el archivo Excel/CSV del sistema.');
      return;
    }
    try {
      const receipts = parseManualGeminiJson(pastedJson, extractedImages);
      setExtractedReceipts(receipts);
      const reconciled = reconcileMovementsAndReceipts(filteredMovements, receipts, {
        dateToleranceDays,
        amountTolerance: 0.05,
      });
      setItems(reconciled);
      setSetupExpanded(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al procesar el JSON pegado.');
    }
  };

  const handleLoadDemo = () => {
    setErrorMsg(null);
    const demo = buildDemoData();
    setSystemFileName('Anexo_de_Gastos_Demo.xlsx');
    setAllMovements(demo.movements);
    setCajeros(['CCHOQUET']);
    setSelectedCajero('CCHOQUET');
    setDocxFileNames(['21-10-2026.docx']);
    setExtractedImages(demo.images);
    setExtractedReceipts(demo.receipts);

    const reconciled = reconcileMovementsAndReceipts(demo.movements, demo.receipts, {
      dateToleranceDays,
      amountTolerance: 0.05,
    });
    setItems(reconciled);
    setActiveTab('todos');
    setSetupExpanded(false);
  };

  const handleReconcileOnly = (newCajero = selectedCajero, newTolerance = dateToleranceDays) => {
    if (extractedReceipts.length === 0 || allMovements.length === 0) return;
    const movs =
      newCajero === 'TODOS' ? allMovements : allMovements.filter((m) => m.cajero === newCajero);
    const reconciled = reconcileMovementsAndReceipts(movs, extractedReceipts, {
      dateToleranceDays: newTolerance,
      amountTolerance: 0.05,
    });
    setItems(reconciled);
  };

  const handleSmartReconcile = () => {
    if (items.length === 0) return;

    // Preserve any item already marked as "Validado" or manually linked by the auditor.
    const lockedItems = items.filter(
      (it) => it.status === 'validado' || it.id.startsWith('linked-')
    );
    const unlockedItems = items.filter(
      (it) => it.status !== 'validado' && !it.id.startsWith('linked-')
    );

    if (unlockedItems.length === 0) {
      window.alert('Todos los registros ya están validados o vinculados manualmente.');
      return;
    }

    const ok = window.confirm(
      `Se conservarán intactos ${lockedItems.length} registros ya validados/vinculados y se volverán a conciliar los ${unlockedItems.length} restantes con las reglas nuevas (prioridad de N° y bloqueo de N° distintos).\n\n¿Continuar?`
    );
    if (!ok) return;

    const lockedSysIds = new Set<string>();
    const lockedRecIds = new Set<string>();
    for (const it of lockedItems) {
      for (const m of it.systemMovements) lockedSysIds.add(m.id);
      for (const r of it.receipts) lockedRecIds.add(r.id);
    }

    const customNotesBySys = new Map<string, string>();
    const customNotesByRec = new Map<string, string>();
    const auditFieldBySys = new Map<string, string>();
    const auditFieldByRec = new Map<string, string>();
    for (const it of unlockedItems) {
      const note = it.auditorNote.trim();
      if (note && !note.startsWith('Diferencia de fecha:')) {
        for (const m of it.systemMovements) customNotesBySys.set(m.id, note);
        for (const r of it.receipts) customNotesByRec.set(r.id, note);
      }
      const af = (it.auditField ?? '').trim();
      if (af) {
        for (const m of it.systemMovements) auditFieldBySys.set(m.id, af);
        for (const r of it.receipts) auditFieldByRec.set(r.id, af);
      }
    }

    const remainingMovs = filteredMovements.filter((m) => !lockedSysIds.has(m.id));
    const recSource =
      extractedReceipts.length > 0 ? extractedReceipts : items.flatMap((it) => it.receipts);
    const seenRec = new Set<string>();
    const remainingRecs: ExtractedReceipt[] = [];
    for (const r of recSource) {
      if (lockedRecIds.has(r.id) || seenRec.has(r.id)) continue;
      seenRec.add(r.id);
      remainingRecs.push(r);
    }

    const reReconciled = reconcileMovementsAndReceipts(remainingMovs, remainingRecs, {
      dateToleranceDays,
      amountTolerance: 0.05,
    }).map((it) => {
      const recoveredNote =
        it.systemMovements.map((m) => customNotesBySys.get(m.id)).find(Boolean) ??
        it.receipts.map((r) => customNotesByRec.get(r.id)).find(Boolean);
      const recoveredAudit =
        it.systemMovements.map((m) => auditFieldBySys.get(m.id)).find(Boolean) ??
        it.receipts.map((r) => auditFieldByRec.get(r.id)).find(Boolean);
      const mergedNote = recoveredNote
        ? it.auditorNote.trim()
          ? `${it.auditorNote.trim()} | ${recoveredNote}`
          : recoveredNote
        : it.auditorNote;
      return {
        ...it,
        auditorNote: mergedNote,
        ...(recoveredAudit ? { auditField: recoveredAudit } : {}),
      };
    });

    const combined = [...reReconciled, ...lockedItems];
    const order: Record<AuditStatus, number> = {
      revisar: 0,
      sin_respaldo: 1,
      no_registrado: 2,
      conciliado: 3,
      validado: 4,
    };
    combined.sort((a, b) => order[a.status] - order[b.status]);

    setItems(combined);
    setDetailItemId(null);
    setModalNavIds([]);
  };

  const handleSaveBackup = () => {
    downloadSessionBackup(buildCurrentSession());
  };

  const handleImportBackup = async (file: File) => {
    setErrorMsg(null);
    try {
      const saved = await readSessionBackupFile(file);
      const migratedItems = migrateLegacyItems(saved.items, saved.categories);
      setSystemFileName(saved.systemFileName);
      setAllMovements(saved.allMovements);
      setCajeros(saved.cajeros);
      setSelectedCajero(saved.selectedCajero);
      setDocxFileNames(saved.docxFileNames);
      setExtractedImages(saved.extractedImages);
      setExtractedReceipts(saved.extractedReceipts);
      setPastedJson(saved.pastedJson);
      setDateToleranceDays(saved.dateToleranceDays);
      setItems(migratedItems);
      setSetupExpanded(migratedItems.length === 0);
      const updated: SavedSession = { ...saved, items: migratedItems, categories: undefined };
      await saveSessionToDb(updated);
      setLastSavedAt(saved.savedAt);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al abrir el proyecto.');
    }
  };

  const handleClearSession = async () => {
    const ok = window.confirm(
      '¿Seguro que querés limpiar la auditoría actual? Se borrará el progreso guardado en este navegador.'
    );
    if (!ok) return;
    await clearSessionInDb().catch(() => {});
    setSystemFileName(null);
    setAllMovements([]);
    setCajeros([]);
    setSelectedCajero('TODOS');
    setDocxFileNames([]);
    setExtractedImages([]);
    setExtractedReceipts([]);
    setPastedJson('');
    setItems([]);
    setDetailItemId(null);
    setLastSavedAt(null);
    setErrorMsg(null);
    setSetupExpanded(true);
  };

  const handleChangeStatus = (itemId: string, status: AuditStatus) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, status } : it)));
  };

  const handleUnlinkItem = (itemId: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.id === itemId);
      if (!target || target.systemMovements.length === 0 || target.receipts.length === 0) {
        return prev;
      }
      const unbacked: ReconciliationItem[] = target.systemMovements.map((sys) => ({
        id: `unlinked-sys-${sys.id}-${Date.now()}`,
        status: 'sin_respaldo',
        reason: 'Desvinculado manualmente por auditoría (sin comprobante válido)',
        matchScore: 0,
        systemMovements: [sys],
        receipts: [],
        hasDuplicateAlert: false,
        manualState: 'pendiente',
        auditorNote: target.auditorNote,
        auditField: target.auditField,
      }));
      const unregistered: ReconciliationItem[] = target.receipts.map((rec) => ({
        id: `unlinked-rec-${rec.id}-${Date.now()}`,
        status: 'no_registrado',
        reason: 'Comprobante desvinculado manualmente por auditoría',
        matchScore: 0,
        systemMovements: [],
        receipts: [rec],
        hasDuplicateAlert: rec.isDuplicateImage || rec.isDuplicateReceipt,
        duplicateDetails: rec.duplicateReason,
        manualState: 'pendiente',
        auditorNote: '',
      }));
      const idx = prev.findIndex((it) => it.id === itemId);
      const next = [...prev];
      next.splice(idx, 1, ...unbacked, ...unregistered);
      return next;
    });
    setDetailItemId(null);
    setModalNavIds([]);
  };

  const handleLinkItems = (currentItemId: string, targetItemId: string) => {
    const mergedId = `linked-${Date.now()}`;
    setItems((prev) => {
      const a = prev.find((it) => it.id === currentItemId);
      const b = prev.find((it) => it.id === targetItemId);
      if (!a || !b) return prev;

      const systemMovements = [...a.systemMovements, ...b.systemMovements];
      const receipts = [...a.receipts, ...b.receipts];
      const mergedNote = [a.auditorNote.trim(), b.auditorNote.trim()]
        .filter(Boolean)
        .join(' | ');
      const mergedAudit = [(a.auditField ?? '').trim(), (b.auditField ?? '').trim()]
        .filter(Boolean)
        .join(' | ');

      const merged: ReconciliationItem = {
        id: mergedId,
        status: 'validado',
        reason: 'Vinculado y validado manualmente por auditoría',
        matchScore: 100,
        systemMovements,
        receipts,
        hasDuplicateAlert: a.hasDuplicateAlert || b.hasDuplicateAlert,
        duplicateDetails: a.duplicateDetails || b.duplicateDetails,
        manualState: 'aprobado',
        auditorNote: mergedNote,
        auditField: mergedAudit,
      };

      const insertIdx = prev.findIndex((it) => it.id === currentItemId);
      const remaining = prev.filter(
        (it) => it.id !== currentItemId && it.id !== targetItemId
      );
      const next = [...remaining];
      next.splice(Math.min(insertIdx, next.length), 0, merged);
      return next;
    });

    setDetailItemId(mergedId);
    setModalNavIds((prev) =>
      prev
        .map((id) => (id === currentItemId ? mergedId : id))
        .filter((id) => id !== targetItemId)
    );
  };

  const handleToggleFlipMinuta = (minutaFile: string) => {
    const key = minutaFile.toLowerCase();
    setFlippedMinutas((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem('concilens_flipped_minutas', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const handleSaveNote = (itemId: string, auditorNote: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, auditorNote } : it)));
  };

  const handleSaveAuditField = (itemId: string, auditField: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, auditField } : it)));
  };

  const counts = useMemo(() => {
    const c = {
      todos: items.length,
      excepciones: 0,
      validado: 0,
      conciliado: 0,
      revisar: 0,
      sin_respaldo: 0,
      no_registrado: 0,
      duplicados: 0,
    };
    for (const it of items) {
      c[it.status]++;
      if (it.status !== 'conciliado' && it.status !== 'validado') c.excepciones++;
      if (it.hasDuplicateAlert) c.duplicados++;
    }
    return c;
  }, [items]);

  const getItemColValues = (it: ReconciliationItem, col: ColumnKey): string[] => {
    const sys = it.systemMovements[0];
    const rec = it.receipts[0];
    const amount = sys?.total ?? it.receipts.reduce((sum, r) => sum + (r.importe ?? 0), 0);

    switch (col) {
      case 'estado':
        return [STATUS_META[it.status].label];
      case 'fecha':
        return [sys?.fecha ?? rec?.fecha ?? '(Sin fecha)'];
      case 'numero':
        return [sys?.numero || rec?.nroComprobante || '(Sin número)'];
      case 'proveedor':
        return [sys?.descripcion || sys?.razonSocial || rec?.proveedorOConcepto || '(Sin proveedor)'];
      case 'importe':
        return [formatARS(amount)];
      case 'minuta':
        return [rec ? rec.minutaFile : '(Sin minuta)'];
      case 'observacion':
        return it.auditorNote.trim() ? ['Con observación (📝)'] : ['(Sin observación)'];
      case 'auditoria':
        return (it.auditField ?? '').trim() ? ['Con nota auditor (✍️)'] : ['(Vacío)'];
    }
  };

  const uniqueColValues = useMemo(() => {
    const result = {} as Record<ColumnKey, Array<{ value: string; count: number }>>;
    for (const col of COLUMN_DEFS) {
      const map = new Map<string, number>();
      for (const it of items) {
        for (const val of getItemColValues(it, col.key)) {
          map.set(val, (map.get(val) ?? 0) + 1);
        }
      }
      result[col.key] = Array.from(map.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value.localeCompare(b.value, 'es', { numeric: true }));
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const activeColFiltersCount = useMemo(
    () =>
      COLUMN_DEFS.filter(
        (c) => colFilters[c.key].trim().length > 0 || colSelectedValues[c.key].length > 0
      ).length,
    [colFilters, colSelectedValues]
  );

  const clearColFilters = () => {
    setColFilters({
      estado: '',
      fecha: '',
      numero: '',
      proveedor: '',
      importe: '',
      minuta: '',
      observacion: '',
      auditoria: '',
    });
    setColSelectedValues({
      estado: [],
      fecha: [],
      numero: [],
      proveedor: [],
      importe: [],
      minuta: [],
      observacion: [],
      auditoria: [],
    });
  };

  const toggleColValue = (col: ColumnKey, value: string) => {
    setColSelectedValues((prev) => {
      const cur = prev[col];
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      return { ...prev, [col]: next };
    });
  };

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (activeTab === 'excepciones' && (it.status === 'conciliado' || it.status === 'validado')) {
        return false;
      }
      if (activeTab === 'duplicados' && !it.hasDuplicateAlert) return false;
      if (
        activeTab !== 'todos' &&
        activeTab !== 'excepciones' &&
        activeTab !== 'duplicados' &&
        it.status !== activeTab
      ) {
        return false;
      }

      // Per-column checkbox & text filters
      for (const col of COLUMN_DEFS) {
        const vals = getItemColValues(it, col.key);
        const selected = colSelectedValues[col.key];
        if (selected.length > 0 && !vals.some((v) => selected.includes(v))) {
          return false;
        }
        const txtFilter = colFilters[col.key].trim().toLowerCase();
        if (txtFilter && selected.length === 0) {
          const extra =
            col.key === 'observacion'
              ? ` ${it.auditorNote}`
              : col.key === 'auditoria'
                ? ` ${it.auditField ?? ''}`
                : col.key === 'proveedor'
                  ? ` ${it.reason}`
                  : '';
          const combined = `${vals.join(' ')}${extra}`.toLowerCase();
          if (!combined.includes(txtFilter)) return false;
        }
      }

      if (!q) return true;
      const haystack = [
        STATUS_META[it.status].label,
        it.reason,
        it.auditorNote,
        it.auditField ?? '',
        ...it.systemMovements.map(
          (m) => `${m.numero} ${m.razonSocial} ${m.descripcion} ${m.balance} ${m.fecha} ${m.total}`
        ),
        ...it.receipts.map(
          (r) =>
            `${r.nroComprobante} ${r.proveedorOConcepto} ${r.minutaFile} ${r.fecha ?? ''} ${r.importe ?? ''}`
        ),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeTab, colFilters, colSelectedValues, searchQuery]);

  const detailItem = useMemo(
    () => items.find((it) => it.id === detailItemId) ?? null,
    [items, detailItemId]
  );

  const ctxItem = useMemo(
    () => (ctxMenu ? items.find((it) => it.id === ctxMenu.itemId) ?? null : null),
    [items, ctxMenu]
  );

  const formattedSavedTime = useMemo(() => {
    if (!lastSavedAt) return null;
    try {
      return new Date(lastSavedAt).toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  }, [lastSavedAt]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Top Navbar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-slate-900">Concilens</h1>
                {formattedSavedTime && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    Guardado {formattedSavedTime}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Conciliación inteligente de minutas .docx vs. Anexo de Gastos
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleLoadDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Play className="h-3.5 w-3.5 text-indigo-600" />
              Demo
            </button>
            <button
              type="button"
              onClick={() => backupInputRef.current?.click()}
              title="Abrir un proyecto guardado (.json)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <FolderOpen className="h-3.5 w-3.5 text-slate-500" />
              Abrir
            </button>
            <input
              ref={backupInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportBackup(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={allMovements.length === 0 && items.length === 0}
              onClick={handleSaveBackup}
              title="Descargar copia de respaldo del proyecto (.json)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5 text-slate-500" />
              Guardar
            </button>
            <button
              type="button"
              disabled={items.length === 0}
              onClick={handleSmartReconcile}
              title="Re-conciliar registros pendientes con las reglas actuales conservando tus validados y vinculaciones manuales"
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-conciliar
            </button>
            <button
              type="button"
              disabled={allMovements.length === 0 && extractedImages.length === 0 && items.length === 0}
              onClick={handleClearSession}
              title="Limpiar auditoría actual"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Limpiar
            </button>
            <button
              type="button"
              disabled={items.length === 0}
              onClick={() => exportAuditToExcel(items)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar Excel
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4 sm:px-6">
        {/* Collapsible Setup & Upload Section */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setSetupExpanded((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">
                1. Carga de archivos y lectura con Gemini
              </span>
              {systemFileName && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                  Sistema: {filteredMovements.length} mov.
                </span>
              )}
              {extractedImages.length > 0 && (
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                  Minutas: {docxFileNames.length} arch. ({extractedImages.length} hojas)
                </span>
              )}
              {duplicateImagesCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  {duplicateImagesCount} img. duplicadas
                </span>
              )}
            </div>
            {setupExpanded ? (
              <ChevronUp className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {setupExpanded && (
            <div className="border-t border-slate-100 p-4">
              <div className="grid gap-4 lg:grid-cols-3">
                {/* 1. System Excel */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                      Listado del Sistema (.xlsx / .csv)
                    </div>
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-3 py-5 text-center transition hover:border-indigo-400">
                      <span className="text-xs font-medium text-slate-700">
                        {systemFileName ?? 'Arrastrá o elegí el Anexo de Gastos'}
                      </span>
                      <span className="mt-1 text-[11px] text-slate-400">
                        Detecta encabezados automáticamente
                      </span>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleExcelUpload(f);
                        }}
                      />
                    </label>
                  </div>

                  {cajeros.length > 0 && (
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                      <label htmlFor="cajero-select" className="font-medium text-slate-600">
                        Filtrar Cajero:
                      </label>
                      <select
                        id="cajero-select"
                        value={selectedCajero}
                        onChange={(e) => {
                          setSelectedCajero(e.target.value);
                          handleReconcileOnly(e.target.value, dateToleranceDays);
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800"
                      >
                        <option value="TODOS">Todos ({allMovements.length})</option>
                        {cajeros.map((c) => (
                          <option key={c} value={c}>
                            {c} ({allMovements.filter((m) => m.cajero === c).length})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* 2. Minutas .docx / .msg / .eml */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <FileText className="h-4 w-4 text-indigo-600" />
                      Minutas (.docx) o Correos (.msg / .eml)
                    </div>
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-3 py-5 text-center transition hover:border-indigo-400">
                      <span className="text-xs font-medium text-slate-700">
                        {docxFileNames.length > 0
                          ? `${docxFileNames.length} minutas cargadas (${extractedImages.length} hojas)`
                          : 'Seleccioná .docx o correos .msg / .eml de Outlook'}
                      </span>
                      <span className="mt-1 text-[11px] text-slate-400">
                        Extrae los .docx adjuntos de los mails + hash SHA-256
                      </span>
                      <input
                        type="file"
                        accept=".docx,.msg,.eml"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) handleDocxUpload(e.target.files);
                        }}
                      />
                    </label>
                  </div>
                  {docxFileNames.length > 0 && (
                    <p
                      className="mt-3 truncate text-[11px] text-slate-500"
                      title={docxFileNames.join(', ')}
                    >
                      Archivos: {docxFileNames.join(', ')}
                    </p>
                  )}
                </div>

                {/* 3. Gemini Chat Workflow */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        <MessageSquare className="h-4 w-4 text-indigo-600" />
                        Lectura con Gemini Chat
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs">
                        <span className="text-slate-500">Tol. días:</span>
                        <input
                          type="number"
                          min={0}
                          max={15}
                          value={dateToleranceDays}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value) || 0);
                            setDateToleranceDays(v);
                            handleReconcileOnly(selectedCajero, v);
                          }}
                          className="w-8 text-right font-semibold text-slate-800 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        disabled={extractedImages.length === 0}
                        onClick={() =>
                          exportImagesToPdfForGemini(extractedImages).catch((e) =>
                            setErrorMsg(e instanceof Error ? e.message : 'Error al generar PDF.')
                          )
                        }
                        title="Genera 1 solo PDF con todas las hojas de tus .docx para subir a Gemini Pro"
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        1. Bajar PDF
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                      >
                        {promptCopied ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ¡Prompt copiado!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            2. Copiar Prompt
                          </>
                        )}
                      </button>
                    </div>

                    <textarea
                      rows={3}
                      value={pastedJson}
                      onChange={(e) => setPastedJson(e.target.value)}
                      placeholder='3. Subí el PDF + Prompt a tu Gemini Pro y pegá acá el JSON que devuelve...'
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-800 placeholder:font-sans placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleRunReconciliation}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                  >
                    <Sparkles className="h-4 w-4" />
                    Procesar y Conciliar
                  </button>
                </div>
              </div>

              {errorMsg && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                  <span>{errorMsg}</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* KPI Summary Strip */}
        {items.length > 0 && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              { label: 'Total ítems', value: counts.todos, accent: 'text-slate-900' },
              { label: '✅ Validados', value: counts.validado, accent: 'text-emerald-700' },
              { label: '🟢 Conciliados', value: counts.conciliado, accent: 'text-teal-700' },
              { label: '🟡 A revisar', value: counts.revisar, accent: 'text-amber-700' },
              { label: '🔴 Sin respaldo', value: counts.sin_respaldo, accent: 'text-rose-700' },
              { label: '🔵 No registrados', value: counts.no_registrado, accent: 'text-sky-700' },
              { label: '⚠️ Duplicados', value: counts.duplicados, accent: 'text-amber-800' },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${kpi.accent}`}>{kpi.value}</p>
              </div>
            ))}
          </section>
        )}

        {/* Full-Width Audit Table */}
        {items.length > 0 && (
          <section className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Top Toolbar: Status Tabs + Search */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: 'excepciones', label: `Excepciones (${counts.excepciones})` },
                    { key: 'todos', label: `Todos (${counts.todos})` },
                    { key: 'validado', label: `Validados (${counts.validado})` },
                    { key: 'conciliado', label: `Conciliados (${counts.conciliado})` },
                    { key: 'revisar', label: `Revisar (${counts.revisar})` },
                    { key: 'sin_respaldo', label: `Sin respaldo (${counts.sin_respaldo})` },
                    { key: 'no_registrado', label: `No reg. (${counts.no_registrado})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      activeTab === tab.key
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar proveedor, N°, estado u obs…"
                  className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Meta Hint */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[11px] text-slate-500">
              <div className="flex items-center gap-2">
                <span>
                  Mostrando {visibleItems.length} de {items.length} registros
                </span>
                {activeColFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={clearColFilters}
                    className="rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-200"
                  >
                    Limpiar {activeColFiltersCount}{' '}
                    {activeColFiltersCount === 1 ? 'filtro' : 'filtros'} ×
                  </button>
                )}
              </div>
              <span>
                Clic simple: ventana de comprobante · Clic sostenido (o derecho): cambiar estado
              </span>
            </div>

            {/* Table */}
            <div className="max-h-[680px] flex-1 overflow-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    {COLUMN_DEFS.map((col) => {
                      const hasVal =
                        colFilters[col.key].trim().length > 0 ||
                        colSelectedValues[col.key].length > 0;
                      const isOpen = openColFilter === col.key;
                      const filterQ = colFilters[col.key].trim().toLowerCase();
                      const options = (uniqueColValues[col.key] ?? []).filter((opt) =>
                        !filterQ ? true : opt.value.toLowerCase().includes(filterQ)
                      );
                      const selectedSet = new Set(colSelectedValues[col.key]);

                      return (
                        <th
                          key={col.key}
                          className={`relative px-3 py-2.5 ${col.alignRight ? 'text-right' : ''}`}
                        >
                          <div
                            className={`inline-flex items-center gap-1 ${col.alignRight ? 'justify-end' : ''}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span>{col.label}</span>
                            <button
                              type="button"
                              onClick={() => setOpenColFilter(isOpen ? null : col.key)}
                              title={`Filtrar por ${col.label}`}
                              className={`rounded px-1 py-0.5 text-[10px] transition ${
                                hasVal || isOpen
                                  ? 'bg-indigo-600 text-white'
                                  : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'
                              }`}
                            >
                              ▾
                            </button>
                          </div>

                          {isOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className={`absolute top-full z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 text-left font-normal normal-case tracking-normal shadow-xl ${
                                col.key === 'observacion' || col.key === 'auditoria' || col.alignRight
                                  ? 'right-2'
                                  : 'left-2'
                              }`}
                            >
                              <input
                                type="text"
                                autoFocus
                                value={colFilters[col.key]}
                                onChange={(e) =>
                                  setColFilters((prev) => ({
                                    ...prev,
                                    [col.key]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') setOpenColFilter(null);
                                }}
                                placeholder={`Buscar en ${col.label.toLowerCase()}…`}
                                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                              />

                              <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto pr-0.5">
                                {options.length === 0 ? (
                                  <p className="px-2 py-2 text-center text-[11px] text-slate-400">
                                    Sin coincidencias
                                  </p>
                                ) : (
                                  options.map((opt) => {
                                    const checked = selectedSet.has(opt.value);
                                    return (
                                      <label
                                        key={opt.value}
                                        className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                                      >
                                        <span className="flex min-w-0 items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => toggleColValue(col.key, opt.value)}
                                            className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                          />
                                          <span className="truncate" title={opt.value}>
                                            {opt.value}
                                          </span>
                                        </span>
                                        <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">
                                          {opt.count}
                                        </span>
                                      </label>
                                    );
                                  })
                                )}
                              </div>

                              {hasVal && (
                                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5">
                                  <span className="text-[10px] text-slate-400">
                                    {colSelectedValues[col.key].length > 0
                                      ? `${colSelectedValues[col.key].length} selec.`
                                      : 'Filtro de texto'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setColFilters((prev) => ({ ...prev, [col.key]: '' }));
                                      setColSelectedValues((prev) => ({ ...prev, [col.key]: [] }));
                                    }}
                                    className="text-[11px] font-medium text-rose-600 hover:underline"
                                  >
                                    Limpiar
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleItems.map((it) => {
                    const meta = STATUS_META[it.status];
                    const Icon = meta.icon;
                    const sys = it.systemMovements[0];
                    const rec = it.receipts[0];
                    const amount =
                      sys?.total ??
                      it.receipts.reduce((sum, r) => sum + (r.importe ?? 0), 0);

                    const cancelLongPress = () => {
                      if (longPressTimerRef.current !== null) {
                        window.clearTimeout(longPressTimerRef.current);
                        longPressTimerRef.current = null;
                      }
                    };

                    const rowTint =
                      it.status === 'validado'
                        ? { backgroundColor: '#16a34a18', boxShadow: 'inset 3px 0 0 #16a34a' }
                        : it.status === 'revisar'
                          ? { backgroundColor: '#d9770614', boxShadow: 'inset 3px 0 0 #d97706' }
                          : undefined;

                    return (
                      <tr
                        key={it.id}
                        style={rowTint}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          longPressTriggeredRef.current = false;
                          const x = e.clientX;
                          const y = e.clientY;
                          cancelLongPress();
                          longPressTimerRef.current = window.setTimeout(() => {
                            longPressTriggeredRef.current = true;
                            setCtxMenu({ itemId: it.id, x, y });
                          }, 450);
                        }}
                        onPointerUp={cancelLongPress}
                        onPointerLeave={cancelLongPress}
                        onPointerCancel={cancelLongPress}
                        onClick={(e) => {
                          if (longPressTriggeredRef.current) {
                            e.stopPropagation();
                            longPressTriggeredRef.current = false;
                            return;
                          }
                          setModalNavIds(visibleItems.map((v) => v.id));
                          setDetailItemId(it.id);
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          cancelLongPress();
                          setCtxMenu({ itemId: it.id, x: e.clientX, y: e.clientY });
                        }}
                        className="cursor-pointer select-none transition hover:bg-indigo-50/50"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.badgeClass}`}
                            >
                              <Icon className="h-3 w-3" />
                              {meta.label}
                            </span>
                            {it.hasDuplicateAlert && (
                              <span title={it.duplicateDetails || 'Posible duplicado'}>
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 tabular-nums">
                          {sys?.fecha ?? rec?.fecha ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-slate-600">
                          {sys?.numero || rec?.nroComprobante || '—'}
                        </td>
                        <td className="max-w-[300px] truncate px-3 py-2.5 font-medium text-slate-800">
                          {sys?.descripcion || sys?.razonSocial || rec?.proveedorOConcepto || '—'}
                          <div className="truncate text-[11px] font-normal text-slate-400">
                            {it.reason}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums">
                          {formatARS(amount)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                          {rec ? rec.minutaFile : '—'}
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5">
                          {it.auditorNote.trim() && (
                            <span
                              title={it.auditorNote}
                              className="inline-flex max-w-full items-center gap-1 truncate rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200"
                            >
                              📝 <span className="truncate">{it.auditorNote}</span>
                            </span>
                          )}
                        </td>
                        <td className="max-w-[200px] px-3 py-2.5">
                          {(it.auditField ?? '').trim() && (
                            <span
                              title={it.auditField}
                              className="inline-flex max-w-full items-center gap-1 truncate rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-800 ring-1 ring-indigo-200"
                            >
                              ✍️ <span className="truncate">{it.auditField}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {visibleItems.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                        No hay resultados para el filtro actual.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* Right-click / Long-press Floating Status Menu */}
      {ctxMenu && ctxItem && (
        <div
          style={{
            position: 'fixed',
            top: Math.min(ctxMenu.y, window.innerHeight - 230),
            left: Math.min(ctxMenu.x, window.innerWidth - 220),
          }}
          onClick={(e) => e.stopPropagation()}
          className="z-50 w-52 rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-xl"
        >
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Cambiar estado
          </p>
          {(
            [
              { key: 'validado', label: '✅ Validado' },
              { key: 'conciliado', label: '🟢 Conciliado' },
              { key: 'revisar', label: '🟡 Revisar' },
              { key: 'sin_respaldo', label: '🔴 Sin respaldo' },
              { key: 'no_registrado', label: '🔵 No registrado' },
            ] as const
          ).map((st) => (
            <button
              key={st.key}
              type="button"
              onClick={() => {
                handleChangeStatus(ctxItem.id, st.key);
                setCtxMenu(null);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-medium transition ${
                ctxItem.status === st.key
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <span>{st.label}</span>
              {ctxItem.status === st.key && <Check className="h-3.5 w-3.5 text-indigo-600" />}
            </button>
          ))}
        </div>
      )}

      {/* Receipt Detail Modal */}
      {(() => {
        const navList = modalNavIds.length > 0 ? modalNavIds : visibleItems.map((v) => v.id);
        const idx = detailItemId ? navList.indexOf(detailItemId) : -1;
        const linkCandidates = detailItem
          ? detailItem.systemMovements.length > 0 && detailItem.receipts.length === 0
            ? items.filter((it) => it.systemMovements.length === 0 && it.receipts.length > 0)
            : detailItem.systemMovements.length === 0 && detailItem.receipts.length > 0
              ? items.filter((it) => it.systemMovements.length > 0 && it.receipts.length === 0)
              : []
          : [];
        return (
          <ReceiptDetailModal
            item={detailItem}
            allImages={extractedImages}
            minutaMonthsMap={minutaMonthsMap}
            flippedMinutas={flippedMinutas}
            linkCandidates={linkCandidates}
            currentIndex={idx}
            totalCount={navList.length}
            hasPrev={idx > 0}
            hasNext={idx >= 0 && idx < navList.length - 1}
            onPrev={() => {
              if (idx > 0) setDetailItemId(navList[idx - 1]);
            }}
            onNext={() => {
              if (idx >= 0 && idx < navList.length - 1) {
                setDetailItemId(navList[idx + 1]);
              }
            }}
            onClose={() => {
              setDetailItemId(null);
              setModalNavIds([]);
            }}
            onChangeStatus={handleChangeStatus}
            onUnlink={handleUnlinkItem}
            onLinkItems={handleLinkItems}
            onToggleFlipMinuta={handleToggleFlipMinuta}
            onSaveNote={handleSaveNote}
            onSaveAuditField={handleSaveAuditField}
          />
        );
      })()}
    </div>
  );
}
