import type { ExtractedImage, ExtractedReceipt } from '../types';
import { normalizeDateString, parseCurrencyAmount } from './dateUtils';

const CACHE_PREFIX = 'concilens_ollama_v1_';

interface RawOllamaReceipt {
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

const OLLAMA_PROMPT = `Eres un auditor contable experto en comprobantes argentinos (facturas A/B/C, tiques factura térmicos, boletas de depósito bancario como Banco Macro, recibos manuscritos "RECIBO N°", vales internos y capturas de transferencia/Mercado Pago).

IMPORTANTE: Una sola imagen escaneada suele contener MÚLTIPLES comprobantes juntos en la misma hoja (2, 3 o más) y algunos pueden estar rotados 90°.
Identifica TODOS los comprobantes visibles y responde ÚNICAMENTE con un JSON válido con este esquema exacto:

{
  "comprobantes": [
    {
      "fecha": "DD/MM/YYYY o null",
      "importe": 12345.67,
      "proveedor_o_concepto": "Nombre del proveedor, empresa recaudadora o persona/concepto",
      "tipo_comprobante": "Tique Factura A | Factura | Boleta Bancaria | Recibo X | Transferencia | Vale Interno | Otro",
      "nro_comprobante": "Número de comprobante, recibo o secuencia o cadena vacía",
      "cuit": "CUIT del emisor o null",
      "posicion": "arriba | medio | abajo | izquierda | derecha | completa",
      "legible": true,
      "notas": "Observaciones breves"
    }
  ]
}

Reglas:
- importe debe ser número decimal con punto (sin $ ni separador de miles).
- En tickets de combustible/supermercado, toma el TOTAL final a pagar.
- En recibos manuscritos ("RECIBO N° 9775696"), extrae el número preimpreso en nro_comprobante.
- Si no hay comprobantes, devuelve { "comprobantes": [] }.`;

async function resizeImageForOllama(dataUrl: string, maxDimension = 1400): Promise<string> {
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
        reject(new Error('No se pudo inicializar canvas.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const resized = canvas.toDataURL('image/jpeg', 0.85);
      resolve(resized.split(',')[1] ?? '');
    };
    img.onerror = () => reject(new Error('Error al cargar imagen para Ollama.'));
    img.src = dataUrl;
  });
}

function getCached(sha256: string, model: string): RawOllamaReceipt[] | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${model}_${sha256}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setCached(sha256: string, model: string, receipts: RawOllamaReceipt[]) {
  try {
    localStorage.setItem(`${CACHE_PREFIX}${model}_${sha256}`, JSON.stringify(receipts));
  } catch {
    // Ignore quota errors
  }
}

export async function fetchOllamaModels(baseUrl: string): Promise<string[]> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const res = await fetch(`${cleanUrl}/api/tags`);
  if (!res.ok) {
    throw new Error(`No se pudo conectar a Ollama (${res.status}).`);
  }
  const data = await res.json();
  const models: Array<{ name?: string }> = Array.isArray(data?.models) ? data.models : [];
  return models.map((m) => m.name ?? '').filter(Boolean);
}

async function analyzeImageWithOllama(
  image: ExtractedImage,
  baseUrl: string,
  model: string
): Promise<ExtractedReceipt[]> {
  let rawReceipts = getCached(image.sha256, model);

  if (!rawReceipts) {
    const base64 = await resizeImageForOllama(image.dataUrl);
    const cleanUrl = baseUrl.replace(/\/+$/, '');

    let res: Response;
    try {
      res = await fetch(`${cleanUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          format: 'json',
          options: { temperature: 0.1 },
          messages: [
            {
              role: 'user',
              content: OLLAMA_PROMPT,
              images: [base64],
            },
          ],
        }),
      });
    } catch {
      throw new Error(
        'No se pudo conectar a Ollama en tu PC. Verificá que Ollama esté abierto y que hayas ejecutado: setx OLLAMA_ORIGINS "*" (y reiniciado Ollama).'
      );
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Error Ollama (${res.status}): ${txt.slice(0, 200)}`);
    }

    const data = await res.json();
    const content: string = data?.message?.content ?? '{}';
    const cleaned = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    const parsedReceipts: RawOllamaReceipt[] = Array.isArray(parsed?.comprobantes)
      ? parsed.comprobantes
      : [];
    rawReceipts = parsedReceipts;
    setCached(image.sha256, model, parsedReceipts);
  }

  return (rawReceipts ?? []).map((r, idx) => {
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

export async function analyzeBatchWithOllama(
  images: ExtractedImage[],
  baseUrl: string,
  model: string,
  onProgress?: (completed: number, total: number, currentLabel: string) => void
): Promise<ExtractedReceipt[]> {
  const results: ExtractedReceipt[] = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    onProgress?.(i, images.length, `${img.minutaFile} — ${img.imageName}`);
    const extracted = await analyzeImageWithOllama(img, baseUrl, model);
    results.push(...extracted);
    onProgress?.(i + 1, images.length, `${img.minutaFile} — ${img.imageName}`);
  }
  return results;
}
