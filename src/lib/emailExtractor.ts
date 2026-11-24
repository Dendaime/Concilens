import * as MsgReaderModule from '@kenjiuno/msgreader';

type MsgReaderInstance = {
  getFileData: () => { attachments?: Array<{ fileName?: string; name?: string }> };
  getAttachment: (att: unknown) => { content?: Uint8Array } | undefined;
};

function createMsgReader(buffer: ArrayBuffer): MsgReaderInstance {
  const mod = MsgReaderModule as unknown as Record<string, unknown>;
  const step1 = mod.default ?? mod;
  const ctor =
    typeof step1 === 'function'
      ? step1
      : typeof (step1 as Record<string, unknown>)?.default === 'function'
        ? (step1 as Record<string, unknown>).default
        : typeof (step1 as Record<string, unknown>)?.MsgReader === 'function'
          ? (step1 as Record<string, unknown>).MsgReader
          : mod.MsgReader;

  if (typeof ctor !== 'function') {
    throw new Error('No se pudo inicializar el lector de archivos .msg en el navegador.');
  }
  return new (ctor as new (buf: ArrayBuffer) => MsgReaderInstance)(buffer);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeMimeFilename(raw: string): string {
  // Handle RFC 2047 =?UTF-8?B?...?= or =?UTF-8?Q?...?= if present
  const b64 = raw.match(/=\?utf-8\?b\?([^?]+)\?=/i);
  if (b64) {
    try {
      const bytes = base64ToUint8Array(b64[1]);
      return new TextDecoder('utf-8').decode(bytes);
    } catch {
      return raw;
    }
  }
  // Handle RFC 2231 UTF-8''encoded
  const rfc2231 = raw.match(/utf-8''(.+)/i);
  if (rfc2231) {
    try {
      return decodeURIComponent(rfc2231[1]);
    } catch {
      return raw;
    }
  }
  return raw;
}

/**
 * Extracts all .docx attachments from an Outlook .msg file using @kenjiuno/msgreader.
 */
async function extractDocxFromMsg(file: File): Promise<File[]> {
  const buffer = await file.arrayBuffer();
  const reader = createMsgReader(buffer);
  const fileData = reader.getFileData();
  const attachments = fileData.attachments ?? [];
  const extracted: File[] = [];

  for (const att of attachments) {
    const name = att.fileName || att.name || '';
    if (!name.toLowerCase().endsWith('.docx')) continue;
    const attContent = reader.getAttachment(att);
    if (!attContent?.content) continue;
    const bytes = new Uint8Array(attContent.content);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: DOCX_MIME });
    extracted.push(new File([blob], name, { type: DOCX_MIME }));
  }

  return extracted;
}

/**
 * Extracts all base64-encoded .docx attachments from a standard .eml (MIME) email file.
 */
async function extractDocxFromEml(file: File): Promise<File[]> {
  const text = await file.text();
  const extracted: File[] = [];

  // Split by MIME boundaries (lines starting with --)
  const boundaryMatch = text.match(/boundary="?([^"\r\n;]+)"?/i);
  const parts = boundaryMatch
    ? text.split(`--${boundaryMatch[1]}`)
    : [text];

  for (const part of parts) {
    const splitIdx = part.search(/\r?\n\r?\n/);
    if (splitIdx === -1) continue;

    const headers = part.slice(0, splitIdx);
    const body = part.slice(splitIdx).trim();

    // Look for filename in Content-Disposition or Content-Type
    const fnMatch =
      headers.match(/filename\*?=(?:"([^"]+)"|([^;\r\n]+))/i) ??
      headers.match(/name=(?:"([^"]+)"|([^;\r\n]+))/i);

    if (!fnMatch) continue;
    const rawName = (fnMatch[1] || fnMatch[2] || '').trim();
    const fileName = decodeMimeFilename(rawName);
    if (!fileName.toLowerCase().endsWith('.docx')) continue;

    if (!/content-transfer-encoding:\s*base64/i.test(headers)) continue;

    // Strip trailing boundary marker if present
    const cleanBody = body.replace(/--\s*$/, '').trim();
    try {
      const bytes = base64ToUint8Array(cleanBody);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: DOCX_MIME });
      extracted.push(new File([blob], fileName, { type: DOCX_MIME }));
    } catch {
      // Skip malformed part
    }
  }

  return extracted;
}

/**
 * Accepts a mixed batch of .docx, .msg (Outlook desktop), and .eml files,
 * returning all .docx files ready for image extraction.
 */
export async function extractDocxFromMixedFiles(
  files: FileList | File[]
): Promise<{ docxFiles: File[]; emailsProcessed: number }> {
  const list = Array.from(files);
  const docxFiles: File[] = [];
  let emailsProcessed = 0;

  for (const file of list) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.docx')) {
      docxFiles.push(file);
    } else if (lower.endsWith('.msg')) {
      emailsProcessed++;
      const found = await extractDocxFromMsg(file);
      docxFiles.push(...found);
    } else if (lower.endsWith('.eml')) {
      emailsProcessed++;
      const found = await extractDocxFromEml(file);
      docxFiles.push(...found);
    }
  }

  return { docxFiles, emailsProcessed };
}
