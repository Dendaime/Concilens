/**
 * Date and currency parsing/formatting helpers tailored for Argentine financial documents.
 */

export function parseDateFromFilename(filename: string): { display: string; iso: string } | null {
  // Matches DD-MM-YYYY, DD_MM_YYYY, DD.MM.YYYY, or YYYY-MM-DD
  const dmy = filename.match(/(\d{1,2})[-_.](\d{1,2})[-_.](\d{4})/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    return { display: `${d}/${m}/${y}`, iso: `${y}-${m}-${d}` };
  }
  const ymd = filename.match(/(\d{4})[-_.](\d{1,2})[-_.](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    return { display: `${d}/${m}/${y}`, iso: `${y}-${m}-${d}` };
  }
  return null;
}

export function normalizeDateString(raw: unknown): { display: string; iso: string } | null {
  if (raw === null || raw === undefined || raw === '') return null;

  // Excel serial date number
  if (typeof raw === 'number' && raw > 25000 && raw < 70000) {
    const utcDays = Math.floor(raw - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return { display: `${d}/${m}/${y}`, iso: `${y}-${m}-${d}` };
  }

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return { display: `${d}/${m}/${y}`, iso: `${y}-${m}-${d}` };
  }

  const str = String(raw).trim();
  if (!str) return null;

  // YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return { display: `${d}/${m}/${y}`, iso: `${y}-${m}-${d}` };
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    const d = dmyMatch[1].padStart(2, '0');
    const m = dmyMatch[2].padStart(2, '0');
    let y = dmyMatch[3];
    if (y.length === 2) {
      y = Number(y) >= 70 ? `19${y}` : `20${y}`;
    }
    return { display: `${d}/${m}/${y}`, iso: `${y}-${m}-${d}` };
  }

  return null;
}

export function diffDaysIso(isoA: string | null, isoB: string | null): number | null {
  if (!isoA || !isoB) return null;
  const a = new Date(`${isoA}T00:00:00Z`).getTime();
  const b = new Date(`${isoB}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round(Math.abs(a - b) / 86400000);
}

export function parseCurrencyAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && !isNaN(raw)) return Math.round(raw * 100) / 100;

  let str = String(raw).trim().replace(/[$€ARS\s]/gi, '');
  if (!str) return null;

  // Handle both 200,000.00 (US) and 200.000,00 (AR/EU) formats
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // 200.000,00 -> remove dots, comma to dot
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // 200,000.00 -> remove commas
      str = str.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const decimals = str.length - lastComma - 1;
    if (decimals === 2 || decimals === 1) {
      str = str.replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  }

  const parsed = Number(str);
  return isNaN(parsed) ? null : Math.round(parsed * 100) / 100;
}

export function formatARS(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
