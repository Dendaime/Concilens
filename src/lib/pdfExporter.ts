import { jsPDF } from 'jspdf';
import type { ExtractedImage } from '../types';

function loadImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
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

  // Track 1-based page index per minuta file
  const pageCounters = new Map<string, number>();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (i > 0) pdf.addPage();

    const filePage = (pageCounters.get(img.minutaFile) ?? 0) + 1;
    pageCounters.set(img.minutaFile, filePage);

    // Header label so Gemini knows exact archivo_minuta and hoja
    pdf.setFontSize(9);
    pdf.setTextColor(71, 85, 105);
    pdf.text(`Archivo: ${img.minutaFile}  |  Hoja: ${filePage}`, margin, margin + 3);

    const { width, height } = await loadImageDimensions(img.dataUrl);
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2 - headerHeight;
    const ratio = Math.min(maxW / width, maxH / height);
    const drawW = width * ratio;
    const drawH = height * ratio;
    const x = (pageWidth - drawW) / 2;
    const y = margin + headerHeight;

    const format = img.mimeType.includes('png') ? 'PNG' : 'JPEG';
    pdf.addImage(img.dataUrl, format, x, y, drawW, drawH, undefined, 'FAST');
  }

  pdf.save(filename);
}
