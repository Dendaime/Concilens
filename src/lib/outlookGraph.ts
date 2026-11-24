import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser';

const GRAPH_SCOPES = ['User.Read', 'Mail.Read'];

let cachedMsal: { clientId: string; app: PublicClientApplication } | null = null;

export function getRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

async function getMsalApp(clientId: string): Promise<PublicClientApplication> {
  const trimmed = clientId.trim();
  if (!trimmed) {
    throw new Error('Ingresá el Application (client) ID de tu App Registration en Microsoft Entra ID.');
  }
  if (cachedMsal && cachedMsal.clientId === trimmed) {
    return cachedMsal.app;
  }
  const app = new PublicClientApplication({
    auth: {
      clientId: trimmed,
      authority: 'https://login.microsoftonline.com/common',
      redirectUri: getRedirectUri(),
    },
    cache: {
      cacheLocation: 'localStorage',
    },
  });
  await app.initialize();
  cachedMsal = { clientId: trimmed, app };
  return app;
}

export async function signInOutlook(clientId: string): Promise<{
  account: AccountInfo;
  accessToken: string;
}> {
  const app = await getMsalApp(clientId);
  const existing = app.getAllAccounts()[0];

  if (existing) {
    try {
      const silent = await app.acquireTokenSilent({
        scopes: GRAPH_SCOPES,
        account: existing,
      });
      return { account: existing, accessToken: silent.accessToken };
    } catch {
      // Fall through to interactive popup
    }
  }

  const loginRes = await app.loginPopup({
    scopes: GRAPH_SCOPES,
    prompt: 'select_account',
  });

  if (!loginRes.account || !loginRes.accessToken) {
    throw new Error('No se pudo completar el inicio de sesión con Microsoft.');
  }

  return { account: loginRes.account, accessToken: loginRes.accessToken };
}

export async function signOutOutlook(clientId: string): Promise<void> {
  if (!clientId.trim()) return;
  const app = await getMsalApp(clientId);
  const account = app.getAllAccounts()[0];
  if (account) {
    await app.logoutPopup({ account });
  }
}

interface GraphMessage {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { address?: string; name?: string } };
}

interface GraphAttachment {
  '@odata.type'?: string;
  name?: string;
  contentType?: string;
  contentBytes?: string;
  isInline?: boolean;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function fetchDocxAttachmentsFromOutlook(
  accessToken: string,
  params: {
    senderEmail: string;
    dateFrom: string; // YYYY-MM-DD
    dateTo: string; // YYYY-MM-DD
  },
  onProgress?: (msg: string) => void
): Promise<{ files: File[]; emailsScanned: number }> {
  const sender = params.senderEmail.trim().toLowerCase();
  if (!sender) {
    throw new Error('Ingresá el correo electrónico del remitente.');
  }

  const filters: string[] = [
    'hasAttachments eq true',
    `from/emailAddress/address eq '${sender.replace(/'/g, "''")}'`,
  ];
  if (params.dateFrom) {
    filters.push(`receivedDateTime ge ${params.dateFrom}T00:00:00Z`);
  }
  if (params.dateTo) {
    filters.push(`receivedDateTime le ${params.dateTo}T23:59:59Z`);
  }

  const query = new URLSearchParams({
    $filter: filters.join(' and '),
    $select: 'id,subject,receivedDateTime,hasAttachments,from',
    $top: '50',
  });

  let nextUrl: string | null = `https://graph.microsoft.com/v1.0/me/messages?${query.toString()}`;
  const messages: GraphMessage[] = [];

  onProgress?.('Buscando correos del remitente en Outlook...');

  while (nextUrl && messages.length < 200) {
    const res: Response = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Error al consultar Outlook (${res.status}): ${txt.slice(0, 220)}`);
    }
    const data: { value?: GraphMessage[]; '@odata.nextLink'?: string } = await res.json();
    if (Array.isArray(data.value)) {
      messages.push(...data.value);
    }
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  const files: File[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    onProgress?.(`Revisando adjuntos (${i + 1} / ${messages.length} correos)...`);

    const attRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(msg.id)}/attachments`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!attRes.ok) continue;

    const attData = await attRes.json();
    const attachments: GraphAttachment[] = Array.isArray(attData.value) ? attData.value : [];

    for (const att of attachments) {
      if (att.isInline) continue;
      const name = att.name ?? '';
      if (!name.toLowerCase().endsWith('.docx')) continue;
      if (!att.contentBytes) continue;

      const bytes = base64ToUint8Array(att.contentBytes);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      files.push(new File([blob], name, { type: blob.type }));
    }
  }

  return { files, emailsScanned: messages.length };
}
