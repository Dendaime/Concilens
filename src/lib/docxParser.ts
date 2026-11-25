import JSZip from 'jszip';
import type { ExtractedImage } from '../types';
import { parseDateFromFilename } from './dateUtils';

const MIN_IMAGE_BYTES = 8 * 1024; // Ignore tiny logos/icons < 8 KB

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'image/jpeg';
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Extracts all receipt/scan images from a batch of .docx minutas in memory,
 * computing SHA-256 hashes to detect duplicate images across minutas.
 */
export async function extractImagesFromDocxFiles(files: File[]): Promise<ExtractedImage[]> {
  const allImages: ExtractedImage[] = [];
  const seenHashes = new Map<string, string>(); // sha256 -> "minutaFile/imageName"
  const nameCounts = new Map<string, number>();

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx];
    const baseKey = file.name.toLowerCase();
    const count = (nameCounts.get(baseKey) ?? 0) + 1;
    nameCounts.set(baseKey, count);

    const displayName =
      count === 1
        ? file.name
        : file.name.replace(/(\.docx)$/i, ` (${count})$1`);

    const zip = await JSZip.loadAsync(file);
    const parsedDate = parseDateFromFilename(file.name);

    const mediaEntries = Object.keys(zip.files)
      .filter((path) => path.startsWith('word/media/') && !zip.files[path].dir)
      .filter((path) => /\.(jpe?g|png|webp|gif)$/i.test(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (const entryPath of mediaEntries) {
      const entry = zip.files[entryPath];
      const buffer = await entry.async('arraybuffer');
      if (buffer.byteLength < MIN_IMAGE_BYTES) continue;

      const imageName = entryPath.split('/').pop() ?? entryPath;
      const mimeType = getMimeType(imageName);
      const sha256 = await sha256Hex(buffer);
      const base64 = arrayBufferToBase64(buffer);
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const refLabel = `${displayName} / ${imageName}`;
      const duplicateOf = seenHashes.get(sha256);
      if (!duplicateOf) {
        seenHashes.set(sha256, refLabel);
      }

      allImages.push({
        id: `f${fileIdx}::${displayName}::${imageName}`,
        minutaFile: displayName,
        minutaDate: parsedDate?.display ?? null,
        minutaDateIso: parsedDate?.iso ?? null,
        imageName,
        mimeType,
        dataUrl,
        sha256,
        sizeBytes: buffer.byteLength,
        duplicateOf,
      });
    }
  }

  return allImages;
}
