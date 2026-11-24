import { useState } from 'react';
import {
  Mail,
  X,
  Copy,
  Check,
  Loader2,
  LogIn,
  LogOut,
  Download,
  AlertTriangle,
  HelpCircle,
} from 'lucide-react';
import {
  fetchDocxAttachmentsFromOutlook,
  getRedirectUri,
  signInOutlook,
  signOutOutlook,
} from '../lib/outlookGraph';

interface OutlookImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportFiles: (files: File[]) => Promise<void>;
}

function defaultMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    from: `${y}-${m}-01`,
    to: `${y}-${m}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function OutlookImportModal({
  isOpen,
  onClose,
  onImportFiles,
}: OutlookImportModalProps) {
  const range = defaultMonthRange();
  const [clientId, setClientId] = useState(
    () => localStorage.getItem('concilens_outlook_client_id') ?? ''
  );
  const [senderEmail, setSenderEmail] = useState(
    () => localStorage.getItem('concilens_outlook_sender') ?? ''
  );
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);

  const [connectedUser, setConnectedUser] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [showSetupHelp, setShowSetupHelp] = useState(!clientId);
  const [copiedUri, setCopiedUri] = useState(false);

  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const redirectUri = getRedirectUri();

  const handleCopyUri = async () => {
    await navigator.clipboard.writeText(redirectUri).catch(() => {});
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  const handleConnect = async () => {
    setErrorMsg(null);
    setStatusMsg('Abriendo inicio de sesión de Microsoft...');
    setBusy(true);
    try {
      const { account, accessToken: token } = await signInOutlook(clientId);
      setConnectedUser(account.username);
      setAccessToken(token);
      setStatusMsg(`Conectado como ${account.username}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo iniciar sesión en Outlook.');
      setStatusMsg(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await signOutOutlook(clientId);
      setConnectedUser(null);
      setAccessToken(null);
      setStatusMsg(null);
    } finally {
      setBusy(false);
    }
  };

  const handleFetch = async () => {
    setErrorMsg(null);
    setBusy(true);
    try {
      let token = accessToken;
      if (!token) {
        const res = await signInOutlook(clientId);
        setConnectedUser(res.account.username);
        setAccessToken(res.accessToken);
        token = res.accessToken;
      }

      const { files, emailsScanned } = await fetchDocxAttachmentsFromOutlook(
        token,
        { senderEmail, dateFrom, dateTo },
        (msg) => setStatusMsg(msg)
      );

      if (files.length === 0) {
        setErrorMsg(
          `Se revisaron ${emailsScanned} correos de ${senderEmail} en ese rango, pero no se encontraron adjuntos .docx.`
        );
        setStatusMsg(null);
        return;
      }

      setStatusMsg(`Importando ${files.length} minutas .docx a Concilens...`);
      await onImportFiles(files);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al descargar adjuntos de Outlook.');
      setStatusMsg(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-white">
              <Mail className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Importar minutas desde Outlook</h2>
              <p className="text-[11px] text-slate-500">
                Conecta vía Microsoft Graph (solo lectura `Mail.Read`)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-5 text-xs">
          {/* Azure Setup Accordion */}
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
            <button
              type="button"
              onClick={() => setShowSetupHelp((v) => !v)}
              className="flex w-full items-center justify-between font-semibold text-sky-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4 text-sky-600" />
                Cómo obtener tu Application (client) ID en 2 minutos (1 sola vez)
              </span>
              <span>{showSetupHelp ? 'Ocultar' : 'Ver pasos'}</span>
            </button>

            {showSetupHelp && (
              <ol className="mt-2.5 list-decimal space-y-1.5 pl-4 text-[11px] text-sky-900/90">
                <li>
                  Entrá a{' '}
                  <a
                    href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline"
                  >
                    Microsoft Entra ID → App registrations
                  </a>{' '}
                  y hacé clic en <strong>New registration</strong> (nombre: <code>Concilens</code>).
                </li>
                <li>
                  En <strong>Supported account types</strong> elegí{' '}
                  <em>Accounts in any organizational directory and personal Microsoft accounts</em>.
                </li>
                <li>
                  En <strong>Redirect URI</strong> elegí plataforma{' '}
                  <strong>Single-page application (SPA)</strong> y pegá exactamente esta URL:
                  <div className="mt-1 flex items-center gap-1.5">
                    <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[10px] text-slate-800 ring-1 ring-sky-200">
                      {redirectUri}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyUri}
                      className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-sky-700"
                    >
                      {copiedUri ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedUri ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                </li>
                <li>
                  Copiá el <strong>Application (client) ID</strong> que aparece en <em>Overview</em>{' '}
                  y pegalo abajo.
                </li>
              </ol>
            )}
          </div>

          {/* Client ID + Connect */}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">
              Application (client) ID (Microsoft Entra ID)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  localStorage.setItem('concilens_outlook_client_id', e.target.value);
                }}
                placeholder="ej: 12345678-abcd-1234-efgh-1234567890ab"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-800 focus:border-sky-500 focus:outline-none"
              />
              {connectedUser ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Salir
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy || !clientId.trim()}
                  onClick={handleConnect}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-40"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Conectar
                </button>
              )}
            </div>
            {connectedUser && (
              <p className="mt-1 text-[11px] font-medium text-emerald-700">
                ✓ Conectado como {connectedUser}
              </p>
            )}
          </div>

          {/* Sender Email */}
          <div>
            <label className="mb-1 block font-semibold text-slate-700">
              Correo del remitente (cajera)
            </label>
            <input
              type="email"
              value={senderEmail}
              onChange={(e) => {
                setSenderEmail(e.target.value);
                localStorage.setItem('concilens_outlook_sender', e.target.value);
              }}
              placeholder="cajera@empresa.com"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-none"
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-semibold text-slate-700">Desde</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold text-slate-700">Hasta</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>

          {statusMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />}
              <span>{statusMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !clientId.trim() || !senderEmail.trim()}
            onClick={handleFetch}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Importar .docx de Outlook
          </button>
        </div>
      </div>
    </div>
  );
}
