import { useMemo, useState } from 'react';
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
  KeyRound,
  Loader2,
} from 'lucide-react';
import type {
  AuditStatus,
  ExtractedImage,
  ExtractedReceipt,
  ManualReviewState,
  ReconciliationItem,
  SystemMovement,
} from './types';
import { parseSystemExcel } from './lib/excelParser';
import { extractImagesFromDocxFiles } from './lib/docxParser';
import { analyzeBatchWithGemini } from './lib/gemini';
import { reconcileMovementsAndReceipts } from './lib/reconcile';
import { exportAuditToExcel } from './lib/exportExcel';
import { formatARS } from './lib/dateUtils';
import { buildDemoData } from './lib/demoData';
import { ReceiptViewer } from './components/ReceiptViewer';

type FilterTab = 'excepciones' | 'todos' | AuditStatus | 'duplicados';

const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recomendado)' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Rápido / Económico)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Máxima precisión)' },
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
  // Config
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('concilens_api_key') ?? '');
  const [model, setModel] = useState('gemini-2.5-flash');
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
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('excepciones');
  const [searchQuery, setSearchQuery] = useState('');
  const [setupExpanded, setSetupExpanded] = useState(true);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(
    null
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const imagesById = useMemo(() => {
    const map = new Map<string, ExtractedImage>();
    for (const img of extractedImages) map.set(img.id, img);
    return map;
  }, [extractedImages]);

  const filteredMovements = useMemo(() => {
    if (selectedCajero === 'TODOS') return allMovements;
    return allMovements.filter((m) => m.cajero === selectedCajero);
  }, [allMovements, selectedCajero]);

  const duplicateImagesCount = useMemo(
    () => extractedImages.filter((i) => Boolean(i.duplicateOf)).length,
    [extractedImages]
  );

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    localStorage.setItem('concilens_api_key', val);
  };

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
    const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith('.docx'));
    if (list.length === 0) {
      setErrorMsg('Seleccioná uno o más archivos .docx de minutas.');
      return;
    }
    try {
      const imgs = await extractImagesFromDocxFiles(list);
      setDocxFileNames(list.map((f) => f.name));
      setExtractedImages(imgs);
      setExtractedReceipts([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al descomprimir los archivos .docx.');
    }
  };

  const handleRunReconciliation = async () => {
    setErrorMsg(null);
    if (filteredMovements.length === 0) {
      setErrorMsg('Primero cargá el archivo Excel/CSV del sistema.');
      return;
    }
    if (extractedImages.length === 0) {
      setErrorMsg('Primero cargá al menos una minuta .docx con imágenes.');
      return;
    }
    if (!apiKey.trim()) {
      setErrorMsg('Ingresá tu API Key de Google AI Studio (Gemini) para analizar las imágenes.');
      return;
    }

    setIsProcessing(true);
    setProgress({ done: 0, total: extractedImages.length, label: 'Iniciando análisis con Gemini...' });

    try {
      const receipts = await analyzeBatchWithGemini(
        extractedImages,
        {
          apiKey: apiKey.trim(),
          model,
          dateToleranceDays,
          amountTolerance: 0.05,
        },
        (done, total, label) => setProgress({ done, total, label })
      );

      setExtractedReceipts(receipts);
      const reconciled = reconcileMovementsAndReceipts(filteredMovements, receipts, {
        dateToleranceDays,
        amountTolerance: 0.05,
      });
      setItems(reconciled);
      setSelectedItemId(reconciled[0]?.id ?? null);
      setSetupExpanded(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error durante el análisis con Gemini.');
    } finally {
      setIsProcessing(false);
      setProgress(null);
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
    setSelectedItemId(reconciled[0]?.id ?? null);
    setActiveTab('todos');
    setSetupExpanded(false);
  };

  // Re-run reconciliation locally if user changes Cajero or date tolerance after receipts are extracted
  const handleReconcileOnly = (newCajero = selectedCajero, newTolerance = dateToleranceDays) => {
    if (extractedReceipts.length === 0 || allMovements.length === 0) return;
    const movs =
      newCajero === 'TODOS' ? allMovements : allMovements.filter((m) => m.cajero === newCajero);
    const reconciled = reconcileMovementsAndReceipts(movs, extractedReceipts, {
      dateToleranceDays: newTolerance,
      amountTolerance: 0.05,
    });
    setItems(reconciled);
    setSelectedItemId(reconciled[0]?.id ?? null);
  };

  const handleUpdateManualState = (itemId: string, manualState: ManualReviewState) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, manualState } : it)));
  };

  const handleUpdateNote = (itemId: string, auditorNote: string) => {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, auditorNote } : it)));
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
      if (!q) return true;
      const haystack = [
        it.reason,
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
  }, [items, activeTab, searchQuery]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Top Navbar */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900">Concilens</h1>
              <p className="text-xs text-slate-500">
                Conciliación inteligente de minutas .docx vs. Anexo de Gastos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleLoadDemo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Play className="h-3.5 w-3.5 text-indigo-600" />
              Cargar Demo
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
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">
                1. Carga de archivos y configuración IA
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

                {/* 2. Minutas .docx */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <FileText className="h-4 w-4 text-indigo-600" />
                      Minutas de Caja (.docx en lote)
                    </div>
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white px-3 py-5 text-center transition hover:border-indigo-400">
                      <span className="text-xs font-medium text-slate-700">
                        {docxFileNames.length > 0
                          ? `${docxFileNames.length} minutas cargadas (${extractedImages.length} hojas)`
                          : 'Seleccioná 1 o varias minutas .docx'}
                      </span>
                      <span className="mt-1 text-[11px] text-slate-400">
                        Descomprime /word/media/ local + hash SHA-256
                      </span>
                      <input
                        type="file"
                        accept=".docx"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) handleDocxUpload(e.target.files);
                        }}
                      />
                    </label>
                  </div>
                  {docxFileNames.length > 0 && (
                    <p className="mt-3 truncate text-[11px] text-slate-500" title={docxFileNames.join(', ')}>
                      Archivos: {docxFileNames.join(', ')}
                    </p>
                  )}
                </div>

                {/* 3. Gemini Config & Run */}
                <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <KeyRound className="h-4 w-4 text-amber-600" />
                      Google AI Studio (Gemini)
                    </div>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => handleApiKeyChange(e.target.value)}
                      placeholder="Pegá tu Gemini API Key (AIza...)"
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800"
                      >
                        {GEMINI_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs">
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
                          className="w-10 text-right font-semibold text-slate-800 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isProcessing}
                    onClick={handleRunReconciliation}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analizando hojas con Gemini...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Procesar y Conciliar
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              {progress && (
                <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-indigo-900">
                    <span>{progress.label}</span>
                    <span className="tabular-nums">
                      {progress.done} / {progress.total} hojas
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-indigo-200">
                    <div
                      className="h-full bg-indigo-600 transition-all duration-300"
                      style={{
                        width: `${progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Error Banner */}
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

        {/* Split-View Audit Workbench */}
        {items.length > 0 && (
          <section className="grid flex-1 gap-4 lg:grid-cols-12">
            {/* Left: Filterable Table */}
            <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-7 xl:col-span-8">
              {/* Filter Tabs & Search */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div className="flex flex-wrap gap-1.5">
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

                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar proveedor, N°, monto..."
                    className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="max-h-[640px] flex-1 overflow-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5">Fecha</th>
                      <th className="px-3 py-2.5">N° Comp.</th>
                      <th className="px-3 py-2.5">Proveedor / Concepto</th>
                      <th className="px-3 py-2.5 text-right">Importe</th>
                      <th className="px-3 py-2.5">Minuta</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleItems.map((it) => {
                      const meta = STATUS_META[it.status];
                      const Icon = meta.icon;
                      const sys = it.systemMovements[0];
                      const rec = it.receipts[0];
                      const isSelected = it.id === selectedItemId;

                      const amount =
                        sys?.total ??
                        it.receipts.reduce((sum, r) => sum + (r.importe ?? 0), 0);

                      return (
                        <tr
                          key={it.id}
                          onClick={() => setSelectedItemId(it.id)}
                          className={`cursor-pointer transition ${
                            isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                          }`}
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
                          <td className="max-w-[240px] truncate px-3 py-2.5 font-medium text-slate-800">
                            {sys?.descripcion || sys?.razonSocial || rec?.proveedorOConcepto || '—'}
                            <div className="truncate text-[11px] font-normal text-slate-400">
                              {it.reason}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums">
                            {formatARS(amount)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-500">
                            {rec ? `${rec.minutaFile}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                          No hay resultados para el filtro actual.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Receipt Image & Audit Panel */}
            <div className="lg:col-span-5 xl:col-span-4">
              <ReceiptViewer
                item={selectedItem}
                imagesById={imagesById}
                onUpdateManualState={handleUpdateManualState}
                onUpdateNote={handleUpdateNote}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
