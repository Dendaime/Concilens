import { jsPDF } from 'jspdf';
import type { ExtractedImage } from '../types';

/**
 * Re-encodes any JPEG/PNG through an HTML canvas into a clean baseline RGB JPEG
 * so jsPDF never produces corrupted/striped pages from progressive or unusual JPEGs.
 */
function normalizeImageViaCanvas(
  dataUrl: string,
  maxDimension = 1800
): Promise<{ cleanDataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth;
      let height = img.naturalHeight;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No se pudo inicializar canvas para generar el PDF.'));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const cleanDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve({ cleanDataUrl, width, height });
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen para generar el PDF.'));
    img.src = dataUrl;
  });
}

/**
 * Combines all extracted .docx images into a single A4 PDF with a header label
 * ("Archivo: ... | Hoja: N") on each page so Gemini Pro Chat can read every scan visually.
 */
export async function exportImagesToPdfForGemini(
  images: ExtractedImage[],
  filename = 'minutas-para-gemini.pdf'
): Promise<void> {
  if (images.length === 0) {
    throw new Error('Primero cargá al menos una minuta .docx.');
  }

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const headerHeight = 8;

  const pageCounters = new Map<string, number>();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (i > 0) pdf.addPage();

    const filePage = (pageCounters.get(img.minutaFile) ?? 0) + 1;
    pageCounters.set(img.minutaFile, filePage);

    pdf.setFontSize(9);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`Archivo: ${img.minutaFile}  |  Hoja: ${filePage}`, margin, margin + 3);

    const { cleanDataUrl, width, height } = await normalizeImageViaCanvas(img.dataUrl);
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2 - headerHeight;
    const ratio = Math.min(maxW / width, maxH / height);
    const drawW = width * ratio;
    const drawH = height * ratio;
    const x = (pageWidth - drawW) / 2;
    const y = margin + headerHeight;

    pdf.addImage(cleanDataUrl, 'JPEG', x, y, drawW, drawH);
  }

  pdf.save(filename);
}
