import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheet,
  FileText,
  Sparkles,
  Download,
  AlertTriangle,
  CheckCircle2,
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
  Tag,
  Plus,
} from 'lucide-react';
import type {
  AuditCategory,
  AuditStatus,
  ExtractedImage,
  ExtractedReceipt,
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
import { CategoryManagerModal } from './components/CategoryManagerModal';

type FilterTab = 'excepciones' | 'todos' | AuditStatus | 'duplicados';

const DEFAULT_CATEGORIES: AuditCategory[] = [
  { id: 'cat-ok', name: 'Revisado OK', color: '#16a34a' },
  { id: 'cat-obs', name: 'Observar monto', color: '#d97706' },
  { id: 'cat-pend', name: 'Pendiente comprobante', color: '#dc2626' },
];

const STATUS_META: Record<
  AuditStatus,
  { label: string; badgeClass: string; icon: typeof CheckCircle2 }
> = {
  conciliado: {
    label: 'Conciliado',
    badgeClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
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

  // Results & Hotelito-style audit categories
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [categories, setCategories] = useState<AuditCategory[]>(DEFAULT_CATEGORIES);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL'); // 'ALL' | 'NONE' | cat.id
  const [catPopoverOpen, setCatPopoverOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);

  // Detail modal & right-click context menu
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ itemId: string; x: number; y: number } | null>(null);

  const [activeTab, setActiveTab] = useState<FilterTab>('excepciones');
  const [searchQuery, setSearchQuery] = useState('');
  const [setupExpanded, setSetupExpanded] = useState(true);

  // Persistence & feedback
  const [hydrated, setHydrated] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  // Close context menu / category popover on outside click
  useEffect(() => {
    const closeMenus = () => {
      setCtxMenu(null);
      setCatPopoverOpen(false);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  // Restore saved session from IndexedDB on mount
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
        setItems(
          saved.items.map((it) => ({
            ...it,
            categoryIds: Array.isArray(it.categoryIds) ? it.categoryIds : [],
          }))
        );
        if (Array.isArray(saved.categories) && saved.categories.length > 0) {
          setCategories(saved.categories);
        }
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
    categories,
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
    categories,
  ]);

  const imagesById = useMemo(() => {
    const map = new Map<string, ExtractedImage>();
    for (const img of extractedImages) map.set(img.id, img);
    return map;
  }, [extractedImages]);

  const categoriesById = useMemo(() => {
    const map = new Map<string, AuditCategory>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

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

  const handleSaveBackup = () => {
    downloadSessionBackup(buildCurrentSession());
  };

  const handleImportBackup = async (file: File) => {
    setErrorMsg(null);
    try {
      const saved = await readSessionBackupFile(file);
      setSystemFileName(saved.systemFileName);
      setAllMovements(saved.allMovements);
      setCajeros(saved.cajeros);
      setSelectedCajero(saved.selectedCajero);
      setDocxFileNames(saved.docxFileNames);
      setExtractedImages(saved.extractedImages);
      setExtractedReceipts(saved.extractedReceipts);
      setPastedJson(saved.pastedJson);
      setDateToleranceDays(saved.dateToleranceDays);
      setItems(
        saved.items.map((it) => ({
          ...it,
          categoryIds: Array.isArray(it.categoryIds) ? it.categoryIds : [],
        }))
      );
      if (Array.isArray(saved.categories) && saved.categories.length > 0) {
        setCategories(saved.categories);
      }
      setSetupExpanded(saved.items.length === 0);
      await saveSessionToDb(saved);
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

  const handleSaveNote = (itemId: string, auditorNote: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, auditorNote } : it)));
  };

  const handleToggleCategory = (itemId: string, categoryId: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        const current = it.categoryIds ?? [];
        const exists = current.includes(categoryId);
        return {
          ...it,
          categoryIds: exists
            ? current.filter((id) => id !== categoryId)
            : [...current, categoryId],
        };
      })
    );
  };

  const handleCreateCategory = (name: string, color: string) => {
    const newCat: AuditCategory = {
      id: `cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      color,
    };
    setCategories((prev) => [...prev, newCat]);
  };

  const handleDeleteCategory = (catId: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== catId));
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        categoryIds: (it.categoryIds ?? []).filter((id) => id !== catId),
      }))
    );
    if (selectedCategoryFilter === catId) setSelectedCategoryFilter('ALL');
  };

  const counts = useMemo(() => {
    const c = {
      todos: items.length,
      excepciones: 0,
      conciliado: 0,
      revisar: 0,
      sin_respaldo: 0,
      no_registrado: 0,
      duplicados: 0,
    };
    for (const it of items) {
      c[it.status]++;
      if (it.status !== 'conciliado') c.excepciones++;
      if (it.hasDuplicateAlert) c.duplicados++;
    }
    return c;
  }, [items]);

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      if (activeTab === 'excepciones' && it.status === 'conciliado') return false;
      if (activeTab === 'duplicados' && !it.hasDuplicateAlert) return false;
      if (
        activeTab !== 'todos' &&
        activeTab !== 'excepciones' &&
        activeTab !== 'duplicados' &&
        it.status !== activeTab
      ) {
        return false;
      }

      // Category filter
      const itemCats = it.categoryIds ?? [];
      if (selectedCategoryFilter === 'NONE' && itemCats.length > 0) return false;
      if (
        selectedCategoryFilter !== 'ALL' &&
        selectedCategoryFilter !== 'NONE' &&
        !itemCats.includes(selectedCategoryFilter)
      ) {
        return false;
      }

      if (!q) return true;
      const catNames = itemCats.map((id) => categoriesById.get(id)?.name ?? '').join(' ');
      const haystack = [
        it.reason,
        it.auditorNote,
        catNames,
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
  }, [items, activeTab, selectedCategoryFilter, searchQuery, categoriesById]);

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
              onClick={() => exportAuditToExcel(items, categories)}
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
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: 'Total ítems', value: counts.todos, accent: 'text-slate-900' },
              { label: '🟢 Conciliados', value: counts.conciliado, accent: 'text-emerald-700' },
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

        {/* Full-Width Hotelito-Style Audit Table */}
        {items.length > 0 && (
          <section className="flex flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Top Toolbar: Status Tabs + Hotelito Category Filter Bar + Search */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: 'excepciones', label: `Excepciones (${counts.excepciones})` },
                    { key: 'todos', label: `Todos (${counts.todos})` },
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

              <div className="flex flex-wrap items-center gap-2">
                {/* Hotelito-style Category Filter Bar */}
                <div className="relative flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryFilter('ALL')}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      selectedCategoryFilter === 'ALL'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Todas
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatPopoverOpen((v) => !v)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      selectedCategoryFilter !== 'ALL'
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Tag className="h-3 w-3" />
                    {selectedCategoryFilter === 'ALL'
                      ? 'Categorías ▾'
                      : selectedCategoryFilter === 'NONE'
                        ? 'Sin categoría ▾'
                        : `${categoriesById.get(selectedCategoryFilter)?.name ?? 'Categoría'} ▾`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatModalOpen(true)}
                    title="Crear o administrar categorías de auditoría"
                    className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>

                  {catPopoverOpen && (
                    <div className="absolute right-0 top-9 z-30 w-56 rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategoryFilter('ALL');
                          setCatPopoverOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100"
                      >
                        <span>Todas las categorías</span>
                        {selectedCategoryFilter === 'ALL' && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCategoryFilter('NONE');
                          setCatPopoverOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-slate-600 hover:bg-slate-100"
                      >
                        <span>Sin categoría</span>
                        {selectedCategoryFilter === 'NONE' && <Check className="h-3.5 w-3.5 text-indigo-600" />}
                      </button>
                      {categories.length > 0 && <div className="my-1 border-t border-slate-100" />}
                      {categories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            setSelectedCategoryFilter(cat.id);
                            setCatPopoverOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: cat.color }}
                            />
                            <span className="truncate">{cat.name}</span>
                          </span>
                          {selectedCategoryFilter === cat.id && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Search */}
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar proveedor, N°, categoría u obs…"
                    className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Hotelito-style Meta Hint */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[11px] text-slate-500">
              <span>Mostrando {visibleItems.length} de {items.length} registros</span>
              <span>Clic simple: ventana de comprobante y observación · Clic derecho: categorizar</span>
            </div>

            {/* Table */}
            <div className="max-h-[680px] flex-1 overflow-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2.5">Estado</th>
                    <th className="px-3 py-2.5">Fecha</th>
                    <th className="px-3 py-2.5">N° Comp.</th>
                    <th className="px-3 py-2.5">Proveedor / Concepto</th>
                    <th className="px-3 py-2.5 text-right">Importe</th>
                    <th className="px-3 py-2.5">Minuta</th>
                    <th className="px-3 py-2.5">Categorías / Obs.</th>
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
                    const itemCats = (it.categoryIds ?? [])
                      .map((id) => categoriesById.get(id))
                      .filter((c): c is AuditCategory => Boolean(c));

                    return (
                      <tr
                        key={it.id}
                        onClick={() => setDetailItemId(it.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setCtxMenu({ itemId: it.id, x: e.clientX, y: e.clientY });
                        }}
                        className="cursor-pointer transition hover:bg-indigo-50/50"
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
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {itemCats.map((cat) => (
                              <span
                                key={cat.id}
                                style={{
                                  backgroundColor: `${cat.color}18`,
                                  color: cat.color,
                                  borderColor: `${cat.color}44`,
                                }}
                                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: cat.color }}
                                />
                                {cat.name}
                              </span>
                            ))}
                            {it.auditorNote.trim() && (
                              <span
                                title={it.auditorNote}
                                className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                              >
                                📝 Obs.
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
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

      {/* Right-click Floating Context Menu (Hotelito style) */}
      {ctxMenu && ctxItem && (
        <div
          style={{
            position: 'fixed',
            top: Math.min(ctxMenu.y, window.innerHeight - 260),
            left: Math.min(ctxMenu.x, window.innerWidth - 230),
          }}
          onClick={(e) => e.stopPropagation()}
          className="z-50 w-56 rounded-xl border border-slate-200 bg-white p-1.5 text-xs shadow-xl"
        >
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Categorizar registro
          </p>
          {categories.map((cat) => {
            const checked = (ctxItem.categoryIds ?? []).includes(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleToggleCategory(ctxItem.id, cat.id)}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left hover:bg-slate-100"
              >
                <span className="flex items-center gap-2 truncate">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="truncate font-medium text-slate-800">{cat.name}</span>
                </span>
                {checked && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
              </button>
            );
          })}
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={() => {
              setCtxMenu(null);
              setCatModalOpen(true);
            }}
            className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left font-medium text-indigo-600 hover:bg-indigo-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Administrar categorías…
          </button>
        </div>
      )}

      {/* Hotelito-style Receipt Detail Modal */}
      <ReceiptDetailModal
        item={detailItem}
        imagesById={imagesById}
        categories={categories}
        onClose={() => setDetailItemId(null)}
        onSaveNote={handleSaveNote}
        onToggleCategory={handleToggleCategory}
        onOpenCategoryManager={() => setCatModalOpen(true)}
      />

      {/* Hotelito-style Category Manager Modal */}
      <CategoryManagerModal
        isOpen={catModalOpen}
        categories={categories}
        onClose={() => setCatModalOpen(false)}
        onCreateCategory={handleCreateCategory}
        onDeleteCategory={handleDeleteCategory}
      />
    </div>
  );
}
