import * as XLSX from 'xlsx';
import type { SystemMovement } from '../types';
import { normalizeDateString, parseCurrencyAmount } from './dateUtils';

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Parses an Excel (.xlsx/.xls) or CSV system expense listing ("Anexo de Gastos").
 * Automatically locates the header row even if preceded by title/blank rows.
 */
export async function parseSystemExcel(file: File): Promise<{
  movements: SystemMovement[];
  cajeros: string[];
  sheetName: string;
}> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
  });

  // Find the header row (look for at least 2 known columns like fecha + total/numero/cajero)
  let headerRowIdx = -1;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const normalized = row.map(normalizeHeader);

    const hasFecha = normalized.some((h) => h.includes('fecha'));
    const hasTotal = normalized.some((h) => h === 'total' || h.includes('importe') || h.includes('monto'));
    const hasNumero = normalized.some((h) => h.includes('numero') || h === 'nro');
    const hasCajero = normalized.some((h) => h.includes('cajero'));

    if ((hasFecha && hasTotal) || (hasTotal && (hasNumero || hasCajero))) {
      headerRowIdx = i;
      normalized.forEach((h, idx) => {
        if (!h) return;
        if (h === 'tipo') colMap.tipo = idx;
        else if (h.startsWith('ser')) colMap.serie = idx;
        else if (h.includes('numero') || h === 'nro') colMap.numero = idx;
        else if (h.includes('fecha')) colMap.fecha = idx;
        else if (h.startsWith('cuen')) colMap.cuenta = idx;
        else if (h.includes('razon')) colMap.razonSocial = idx;
        else if (h === 'total' || h.includes('importe') || h.includes('monto')) colMap.total = idx;
        else if (h === 'caja' || (h.startsWith('caj') && !h.includes('cajero'))) colMap.caja = idx;
        else if (h.includes('cajero')) colMap.cajero = idx;
        else if (h.includes('balance') || h.includes('rubro') || h.includes('categoria')) colMap.balance = idx;
        else if (h.includes('descrip') || h.includes('detalle') || h.includes('concepto')) colMap.descripcion = idx;
      });
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(
      'No se encontraron las columnas esperadas (Fecha, Total, Número, Cajero) en el archivo del sistema.'
    );
  }

  const movements: SystemMovement[] = [];
  const cajeroSet = new Set<string>();

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    const totalVal = colMap.total !== undefined ? parseCurrencyAmount(row[colMap.total]) : null;
    const dateVal = colMap.fecha !== undefined ? normalizeDateString(row[colMap.fecha]) : null;

    // Skip empty or subtotal rows without date and amount
    if (totalVal === null || !dateVal) continue;

    const getStr = (key: string) =>
      colMap[key] !== undefined ? String(row[colMap[key]] ?? '').trim() : '';

    const cajero = getStr('cajero');
    if (cajero) cajeroSet.add(cajero);

    movements.push({
      id: `sys-${r + 1}`,
      rowIndex: r + 1,
      tipo: getStr('tipo'),
      serie: getStr('serie'),
      numero: getStr('numero'),
      fecha: dateVal.display,
      fechaIso: dateVal.iso,
      cuenta: getStr('cuenta'),
      razonSocial: getStr('razonSocial'),
      total: Math.abs(totalVal),
      caja: getStr('caja'),
      cajero,
      balance: getStr('balance'),
      descripcion: getStr('descripcion'),
    });
  }

  return {
    movements,
    cajeros: Array.from(cajeroSet).sort(),
    sheetName,
  };
}
