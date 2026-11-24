import type { ExtractedImage, ExtractedReceipt, GeminiConfig } from '../types';
import { normalizeDateString, parseCurrencyAmount } from './dateUtils';

const CACHE_PREFIX = 'concilens_gemini_v1_';

interface RawGeminiReceipt {
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

interface RawGeminiResponse {
  comprobantes?: RawGeminiReceipt[];
}

const SYSTEM_PROMPT = `Eres un auditor contable experto en comprobantes argentinos (facturas A/B/C, tiques factura térmicos, boletas de depósito bancario como Banco Macro, recibos manuscritos "RECIBO N°", vales internos y capturas de transferencia/Mercado Pago).

IMPORTANTE: Una sola imagen escaneada suele contener MÚLTIPLES comprobantes juntos en la misma hoja (2, 3 o más) y algunos pueden estar rotados 90°.
Debes identificar TODOS y cada uno de los comprobantes visibles en la imagen y devolver un JSON estricto con este esquema exacto:

{
  "comprobantes": [
    {
      "fecha": "DD/MM/YYYY o null si no figura",
      "importe": 12345.67,
      "proveedor_o_concepto": "Nombre del proveedor, empresa recaudadora o persona/concepto",
      "tipo_comprobante": "Tique Factura A | Factura | Boleta Bancaria | Recibo X | Transferencia | Vale Interno | Otro",
      "nro_comprobante": "Número de comprobante, recibo o secuencia (ej: 00048-00038813, 9775696, 1049200626) o cadena vacía",
      "cuit": "CUIT del emisor o null",
      "posicion": "arriba | medio | abajo | izquierda | derecha | completa",
      "legible": true,
      "notas": "Observaciones breves si está borroso, manuscrito dudoso o tiene anotaciones"
    }
  ]
}

Reglas:
- Devuelve el importe como número decimal (punto para decimales, sin separador de miles, sin símbolo $).
- En tickets de combustible/supermercado, toma el TOTAL final a pagar (no subtotales ni efectivo recibido si hay vuelto).
- En recibos manuscritos ("RECIBO N° 9775696"), extrae el número preimpreso en nro_comprobante y el nombre + concepto en proveedor_o_concepto.
- Si la imagen no contiene ningún comprobante de gasto (ej. hoja en blanco), devuelve { "comprobantes": [] }.`;

async function resizeImageForApi(dataUrl: string, maxDimension = 1800): Promise<{ mimeType: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
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
        reject(new Error('No se pudo inicializar canvas para redimensionar la imagen.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const resized = canvas.toDataURL('image/jpeg', 0.85);
      const base64 = resized.split(',')[1] ?? '';
      resolve({ mimeType: 'image/jpeg', base64 });
    };
    img.onerror = () => reject(new Error('Error al cargar la imagen para análisis.'));
    img.src = dataUrl;
  });
}

function getCachedReceipts(sha256: string, model: string): RawGeminiReceipt[] | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${model}_${sha256}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setCachedReceipts(sha256: string, model: string, receipts: RawGeminiReceipt[]) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${model}_${sha256}`, JSON.stringify(receipts));
  } catch {
    // Ignore storage quota errors
  }
}

async function callGeminiOnce(
  apiKey: string,
  model: string,
  mimeType: string,
  base64: string
): Promise<RawGeminiReceipt[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: SYSTEM_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    const err = new Error(`Error Gemini (${response.status}): ${errText.slice(0, 220)}`);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }

  const data = await response.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed: RawGeminiResponse = JSON.parse(cleaned);
  return Array.isArray(parsed.comprobantes) ? parsed.comprobantes : [];
}

export async function analyzeImageWithGemini(
  image: ExtractedImage,
  config: GeminiConfig
): Promise<ExtractedReceipt[]> {
  let rawReceipts = getCachedReceipts(image.sha256, config.model);

  if (!rawReceipts) {
    const { mimeType, base64 } = await resizeImageForApi(image.dataUrl);
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rawReceipts = await callGeminiOnce(config.apiKey, config.model, mimeType, base64);
        setCachedReceipts(image.sha256, config.model, rawReceipts);
        break;
      } catch (err) {
        lastError = err;
        const status = (err as Error & { status?: number }).status;
        if (status === 429 && attempt < 2) {
          await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    if (!rawReceipts) {
      throw lastError ?? new Error('No se pudo analizar la imagen con Gemini.');
    }
  }

  return rawReceipts.map((r, idx) => {
    const parsedDate = normalizeDateString(r.fecha);
    const amount = parseCurrencyAmount(r.importe);

    return {
      id: `${image.id}::r${idx + 1}`,
      imageId: image.id,
      minutaFile: image.minutaFile,
      minutaDate: image.minutaDate,
      minutaDateIso: image.minutaDateIso,
      imageName: image.imageName,
      fecha: parsedDate?.display ?? image.minutaDate,
      fechaIso: parsedDate?.iso ?? image.minutaDateIso,
      importe: amount,
      proveedorOConcepto: String(r.proveedor_o_concepto ?? '').trim() || 'Sin identificar',
      tipoComprobante: String(r.tipo_comprobante ?? 'Comprobante').trim(),
      nroComprobante: String(r.nro_comprobante ?? '').trim(),
      cuit: r.cuit ? String(r.cuit).trim() : null,
      posicion: String(r.posicion ?? 'completa').trim().toLowerCase(),
      legible: r.legible !== false,
      notas: String(r.notas ?? '').trim(),
      isDuplicateImage: Boolean(image.duplicateOf),
      isDuplicateReceipt: false,
      duplicateReason: image.duplicateOf ? `Imagen idéntica a ${image.duplicateOf}` : undefined,
    };
  });
}

export async function analyzeBatchWithGemini(
  images: ExtractedImage[],
  config: GeminiConfig,
  onProgress?: (completed: number, total: number, currentLabel: string) => void
): Promise<ExtractedReceipt[]> {
  const results: ExtractedReceipt[] = [];
  const concurrency = 2;
  let completed = 0;
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < images.length) {
      const idx = nextIdx++;
      const img = images[idx];
      onProgress?.(completed, images.length, `${img.minutaFile} — ${img.imageName}`);
      const extracted = await analyzeImageWithGemini(img, config);
      results.push(...extracted);
      completed++;
      onProgress?.(completed, images.length, `${img.minutaFile} — ${img.imageName}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, images.length) }, () => worker()));
  return results;
}
