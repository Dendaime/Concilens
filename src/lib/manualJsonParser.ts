import type { ExtractedImage, ExtractedReceipt } from '../types';
import { normalizeDateString, parseCurrencyAmount } from './dateUtils';

export const GEMINI_CHAT_PROMPT = `Actuá como auditor contable experto en comprobantes argentinos (boletas bancarias como Banco Macro, tiques factura térmicos, facturas A/B/C, recibos manuscritos "RECIBO N°", transferencias).

Analizá TODOS los archivos adjuntos (.docx o imágenes). Recordá que cada hoja escaneada suele contener MÚLTIPLES comprobantes (2, 3 o más) y algunos pueden estar rotados 90°.

Devolvé ÚNICAMENTE un bloque JSON válido (sin texto adicional) con esta estructura exacta:

\`\`\`json
{
  "comprobantes": [
    {
      "pagina_pdf": 1,
      "archivo_minuta": "21-10-2026.docx",
      "hoja": 1,
      "fecha": "DD/MM/YYYY",
      "importe": 12345.67,
      "proveedor_o_concepto": "Nombre del proveedor, empresa recaudadora o persona/concepto",
      "tipo_comprobante": "Tique Factura A | Factura | Boleta Bancaria | Recibo X | Transferencia | Otro",
      "nro_comprobante": "Número de comprobante, recibo o secuencia (ej: 00048-00038813, 9775696)",
      "cuit": "CUIT del emisor o null",
      "posicion": "arriba | medio | abajo | izquierda | derecha | completa",
      "legible": true,
      "notas": "Observaciones breves"
    }
  ]
}
\`\`\`

Reglas:
- importe debe ser número con punto decimal, sin $ ni separador de miles (ej: 130011.99).
- En tickets de combustible/supermercado, usá el TOTAL final a pagar.
- En recibos manuscritos ("RECIBO N° 9775696"), poné el número preimpreso en nro_comprobante.
- En pagina_pdf poné el número "Pág. PDF" que figura en el encabezado de cada página.`;

interface RawManualReceipt {
  pagina_pdf?: number | string | null;
  archivo_minuta?: string | null;
  hoja?: number | string | null;
  fecha?: string | null;
  importe?: number | string | null;
  proveedor_o_concepto?: string | null;
  tipo_comprobante?: string | null;
  nro_comprobante?: string | null;
  cuit?: string | null;
  posicion?: string | null;
  legible?: boolean;
  notas?: string | null;
}

/**
 * Parses a JSON block pasted from Gemini Pro chat and links each receipt
 * to the corresponding extracted .docx image (when .docx files are also loaded).
 */
export function parseManualGeminiJson(
  rawText: string,
  extractedImages: ExtractedImage[]
): ExtractedReceipt[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error('Pegá el bloque JSON que te devolvió Gemini Pro.');
  }

  // Extract JSON from markdown code fences if present
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenceMatch ? fenceMatch[1] : trimmed).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(
      'El texto pegado no es un JSON válido. Asegurate de copiar el bloque completo desde { hasta }.'
    );
  }

  const list: RawManualReceipt[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { comprobantes?: unknown })?.comprobantes)
      ? ((parsed as { comprobantes: RawManualReceipt[] }).comprobantes)
      : [];

  if (list.length === 0) {
    throw new Error('No se encontraron comprobantes dentro del JSON pegado.');
  }

  // Group extracted images by normalized minuta filename for easy linking
  const imagesByFile = new Map<string, ExtractedImage[]>();
  for (const img of extractedImages) {
    const key = img.minutaFile.toLowerCase();
    const arr = imagesByFile.get(key) ?? [];
    arr.push(img);
    imagesByFile.set(key, arr);
  }

  return list.map((r, idx) => {
    const pdfPage = Number(r.pagina_pdf);
    const fileHint = String(r.archivo_minuta ?? '').trim();
    const pageNum = Number(r.hoja);

    // 1) Exact global PDF page match if provided
    let matchedImg: ExtractedImage | undefined;
    if (!isNaN(pdfPage) && pdfPage >= 1 && pdfPage <= extractedImages.length) {
      matchedImg = extractedImages[pdfPage - 1];
    }

    // 2) Fallback to archivo_minuta + hoja
    if (!matchedImg && extractedImages.length > 0) {
      let fileImages = fileHint ? imagesByFile.get(fileHint.toLowerCase()) : undefined;
      if (!fileImages && fileHint) {
        for (const [k, v] of imagesByFile.entries()) {
          if (k.includes(fileHint.toLowerCase()) || fileHint.toLowerCase().includes(k.replace('.docx', ''))) {
            fileImages = v;
            break;
          }
        }
      }
      if (!fileImages && imagesByFile.size === 1) {
        fileImages = Array.from(imagesByFile.values())[0];
      }
      if (fileImages && fileImages.length > 0) {
        if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= fileImages.length) {
          matchedImg = fileImages[pageNum - 1];
        } else {
          matchedImg = fileImages[0];
        }
      }
    }

    const parsedDate = normalizeDateString(r.fecha);
    const amount = parseCurrencyAmount(r.importe);

    return {
      id: `chat::r${idx + 1}`,
      imageId: matchedImg?.id ?? '',
      minutaFile: matchedImg?.minutaFile ?? (fileHint || 'Gemini Chat'),
      minutaDate: matchedImg?.minutaDate ?? parsedDate?.display ?? null,
      minutaDateIso: matchedImg?.minutaDateIso ?? parsedDate?.iso ?? null,
      imageName: matchedImg?.imageName ?? (pageNum ? `hoja ${pageNum}` : 'JSON'),
      fecha: parsedDate?.display ?? matchedImg?.minutaDate ?? null,
      fechaIso: parsedDate?.iso ?? matchedImg?.minutaDateIso ?? null,
      importe: amount,
      proveedorOConcepto: String(r.proveedor_o_concepto ?? '').trim() || 'Sin identificar',
      tipoComprobante: String(r.tipo_comprobante ?? 'Comprobante').trim(),
      nroComprobante: String(r.nro_comprobante ?? '').trim(),
      cuit: r.cuit ? String(r.cuit).trim() : null,
      posicion: String(r.posicion ?? 'completa').trim().toLowerCase(),
      legible: r.legible !== false,
      notas: String(r.notas ?? '').trim(),
      isDuplicateImage: Boolean(matchedImg?.duplicateOf),
      isDuplicateReceipt: false,
      duplicateReason: matchedImg?.duplicateOf
        ? `Imagen idéntica a ${matchedImg.duplicateOf}`
        : undefined,
    };
  });
}
