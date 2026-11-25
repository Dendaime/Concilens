import type { ExtractedReceipt, ReconciliationItem, SystemMovement } from '../types';
import { diffDaysIso } from './dateUtils';

function normalizeDigits(str: string): string {
  return str.replace(/\D/g, '').replace(/^0+/, '');
}

function numbersMatch(sysNum: string, recNum: string): boolean {
  const a = normalizeDigits(sysNum);
  const b = normalizeDigits(recNum);
  if (a.length < 3 || b.length < 3) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

/**
 * Returns true when BOTH system and receipt have real receipt numbers (>= 4 digits)
 * and they do not match (ignoring short internal OP numbers like "73").
 */
function numbersConflict(sysNum: string, recNum: string): boolean {
  const a = normalizeDigits(sysNum);
  const b = normalizeDigits(recNum);
  if (a.length < 4 || b.length < 4) return false;
  return !numbersMatch(sysNum, recNum);
}

function textSimilarityScore(sys: SystemMovement, rec: ExtractedReceipt): number {
  const sysText = `${sys.razonSocial} ${sys.descripcion} ${sys.balance}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const recTokens = rec.proveedorOConcepto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  if (recTokens.length === 0) return 0;
  let hits = 0;
  for (const token of recTokens) {
    if (sysText.includes(token)) hits++;
  }
  return hits / recTokens.length;
}

function effectiveDateDiff(sys: SystemMovement, rec: ExtractedReceipt): number | null {
  const d1 = diffDaysIso(sys.fechaIso, rec.fechaIso);
  const d2 = diffDaysIso(sys.fechaIso, rec.minutaDateIso);
  if (d1 !== null && d2 !== null) return Math.min(d1, d2);
  return d1 ?? d2;
}

/**
 * Flags logical duplicate receipts (same receipt number + same amount across minutas).
 */
function tagDuplicateReceipts(receipts: ExtractedReceipt[]): ExtractedReceipt[] {
  const seen = new Map<string, ExtractedReceipt>();

  return receipts.map((r) => {
    const clone = { ...r };
    const cleanNum = normalizeDigits(r.nroComprobante);
    if (cleanNum.length >= 4 && r.importe !== null) {
      const key = `${cleanNum}::${r.importe.toFixed(2)}`;
      const prev = seen.get(key);
      if (prev && prev.id !== r.id) {
        clone.isDuplicateReceipt = true;
        clone.duplicateReason = clone.duplicateReason
          ? `${clone.duplicateReason} | Comprobante N° ${r.nroComprobante} repetido (${prev.minutaFile})`
          : `Comprobante N° ${r.nroComprobante} e importe repetidos (ya visto en ${prev.minutaFile})`;
      } else {
        seen.set(key, clone);
      }
    }
    return clone;
  });
}

export function reconcileMovementsAndReceipts(
  movements: SystemMovement[],
  rawReceipts: ExtractedReceipt[],
  options: { dateToleranceDays: number; amountTolerance: number }
): ReconciliationItem[] {
  const { dateToleranceDays, amountTolerance } = options;
  const receipts = tagDuplicateReceipts(rawReceipts);

  const usedSys = new Set<string>();
  const usedRec = new Set<string>();
  const items: ReconciliationItem[] = [];

  // Pass 1: 1-to-1 exact amount + within date tolerance (prioritizing receipt number & vendor match)
  const candidates: Array<{
    sys: SystemMovement;
    rec: ExtractedReceipt;
    score: number;
    dateDiff: number | null;
    amountDiff: number;
    numMatch: boolean;
    numConflict: boolean;
  }> = [];

  for (const sys of movements) {
    for (const rec of receipts) {
      if (rec.importe === null) continue;
      const amountDiff = Math.abs(sys.total - rec.importe);
      if (amountDiff > amountTolerance) continue;

      const dateDiff = effectiveDateDiff(sys, rec);
      const numMatch = numbersMatch(sys.numero, rec.nroComprobante);
      const numConflict = numbersConflict(sys.numero, rec.nroComprobante);
      const textSim = textSimilarityScore(sys, rec);

      if (dateDiff !== null && dateDiff <= dateToleranceDays) {
        let score = 70;
        if (numMatch) score += 25;
        if (numConflict) score -= 20;
        if (dateDiff === 0) score += 10;
        else score += Math.max(0, 8 - dateDiff * 2);
        score += Math.round(textSim * 15);
        candidates.push({ sys, rec, score, dateDiff, amountDiff, numMatch, numConflict });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  for (const c of candidates) {
    if (usedSys.has(c.sys.id) || usedRec.has(c.rec.id)) continue;
    usedSys.add(c.sys.id);
    usedRec.add(c.rec.id);

    const hasDup = c.rec.isDuplicateImage || c.rec.isDuplicateReceipt;
    const isIllegible = !c.rec.legible;

    const status = hasDup || isIllegible || c.numConflict ? 'revisar' : 'conciliado';
    const reasons: string[] = [];
    if (c.numMatch) reasons.push('Coincide importe y N° comprobante');
    else reasons.push('Coincide importe y fecha');
    if (c.numConflict) {
      reasons.push(`N° difiere (Sist: ${c.sys.numero} vs Comp: ${c.rec.nroComprobante})`);
    }
    if (c.amountDiff > 0.005) reasons.push(`dif. $${c.amountDiff.toFixed(2)}`);
    if (c.dateDiff !== null && c.dateDiff > 0) reasons.push(`dif. ${c.dateDiff}d`);
    if (isIllegible) reasons.push('comprobante poco legible');
    if (hasDup) reasons.push('posible duplicado');

    items.push({
      id: `match-${c.sys.id}-${c.rec.id}`,
      status,
      reason: reasons.join(' · '),
      matchScore: Math.min(100, c.score),
      systemMovements: [c.sys],
      receipts: [c.rec],
      hasDuplicateAlert: hasDup,
      duplicateDetails: c.rec.duplicateReason,
      manualState: 'pendiente',
      categoryIds: [],
      auditorNote: '',
    });
  }

  // Pass 2: 1-to-1 exact amount where only the date differs -> 🟢 Conciliado with day-diff observation
  // (or 🟡 Revisar if receipt numbers conflict)
  const dateDiffCandidates: Array<{
    sys: SystemMovement;
    rec: ExtractedReceipt;
    score: number;
    dateDiff: number | null;
    amountDiff: number;
    numMatch: boolean;
    numConflict: boolean;
  }> = [];

  for (const sys of movements) {
    if (usedSys.has(sys.id)) continue;
    for (const rec of receipts) {
      if (usedRec.has(rec.id) || rec.importe === null) continue;
      const amountDiff = Math.abs(sys.total - rec.importe);
      if (amountDiff > amountTolerance) continue;

      const dateDiff = effectiveDateDiff(sys, rec);
      const numMatch = numbersMatch(sys.numero, rec.nroComprobante);
      const numConflict = numbersConflict(sys.numero, rec.nroComprobante);
      const textSim = textSimilarityScore(sys, rec);

      let score = 50;
      if (numMatch) score += 30;
      if (numConflict) score -= 20;
      score += Math.round(textSim * 20);
      if (dateDiff !== null) score -= Math.min(20, dateDiff * 0.5);

      dateDiffCandidates.push({ sys, rec, score, dateDiff, amountDiff, numMatch, numConflict });
    }
  }

  dateDiffCandidates.sort((a, b) => b.score - a.score);

  for (const c of dateDiffCandidates) {
    if (usedSys.has(c.sys.id) || usedRec.has(c.rec.id)) continue;
    usedSys.add(c.sys.id);
    usedRec.add(c.rec.id);

    const hasDup = c.rec.isDuplicateImage || c.rec.isDuplicateReceipt;
    const isIllegible = !c.rec.legible;
    const obsText =
      c.dateDiff !== null
        ? `Diferencia de fecha: ${c.dateDiff} ${c.dateDiff === 1 ? 'día' : 'días'} (Sist: ${c.sys.fecha} vs Comp: ${c.rec.fecha || c.rec.minutaDate || '—'})`
        : 'Diferencia de fecha (sin fecha legible en comprobante)';

    const status = hasDup || isIllegible || c.numConflict ? 'revisar' : 'conciliado';
    const reasons: string[] = [
      c.numMatch ? 'Conciliado por importe y N°' : 'Conciliado por importe',
      obsText,
    ];
    if (c.numConflict) {
      reasons.push(`N° difiere (Sist: ${c.sys.numero} vs Comp: ${c.rec.nroComprobante})`);
    }
    if (c.amountDiff > 0.005) reasons.push(`dif. $${c.amountDiff.toFixed(2)}`);

    items.push({
      id: `match-datediff-${c.sys.id}-${c.rec.id}`,
      status,
      reason: reasons.join(' · '),
      matchScore: Math.min(95, Math.max(40, Math.round(c.score))),
      systemMovements: [c.sys],
      receipts: [c.rec],
      hasDuplicateAlert: hasDup,
      duplicateDetails: c.rec.duplicateReason,
      manualState: 'pendiente',
      categoryIds: [],
      auditorNote: obsText,
    });
  }

  // Pass 3: 2 receipts sum to 1 system movement (within date tolerance) -> 🟡 Revisar
  const remainingReceipts = receipts.filter((r) => !usedRec.has(r.id) && r.importe !== null);
  for (const sys of movements) {
    if (usedSys.has(sys.id)) continue;
    let foundPair: [ExtractedReceipt, ExtractedReceipt] | null = null;

    for (let i = 0; i < remainingReceipts.length && !foundPair; i++) {
      const r1 = remainingReceipts[i];
      if (usedRec.has(r1.id) || r1.importe === null) continue;
      for (let j = i + 1; j < remainingReceipts.length; j++) {
        const r2 = remainingReceipts[j];
        if (usedRec.has(r2.id) || r2.importe === null) continue;
        if (Math.abs(r1.importe + r2.importe - sys.total) <= amountTolerance) {
          const d1 = effectiveDateDiff(sys, r1);
          const d2 = effectiveDateDiff(sys, r2);
          if ((d1 === null || d1 <= dateToleranceDays + 3) && (d2 === null || d2 <= dateToleranceDays + 3)) {
            foundPair = [r1, r2];
            break;
          }
        }
      }
    }

    if (foundPair) {
      usedSys.add(sys.id);
      usedRec.add(foundPair[0].id);
      usedRec.add(foundPair[1].id);
      const hasDup =
        foundPair[0].isDuplicateImage ||
        foundPair[0].isDuplicateReceipt ||
        foundPair[1].isDuplicateImage ||
        foundPair[1].isDuplicateReceipt;

      items.push({
        id: `review-sum-${sys.id}`,
        status: 'revisar',
        reason: 'Suma de 2 comprobantes coincide con 1 movimiento del sistema',
        matchScore: 60,
        systemMovements: [sys],
        receipts: foundPair,
        hasDuplicateAlert: hasDup,
        duplicateDetails: foundPair[0].duplicateReason ?? foundPair[1].duplicateReason,
        manualState: 'pendiente',
      categoryIds: [],
        auditorNote: '',
      });
    }
  }

  // Pass 4: Remaining unmatched system movements -> 🔴 Sin respaldo
  for (const sys of movements) {
    if (usedSys.has(sys.id)) continue;
    items.push({
      id: `unbacked-${sys.id}`,
      status: 'sin_respaldo',
      reason: 'Egreso cargado en sistema sin comprobante coincidente en las minutas',
      matchScore: 0,
      systemMovements: [sys],
      receipts: [],
      hasDuplicateAlert: false,
      manualState: 'pendiente',
      categoryIds: [],
      auditorNote: '',
    });
  }

  // Pass 5: Remaining unmatched receipts -> 🔵 No registrado
  for (const rec of receipts) {
    if (usedRec.has(rec.id)) continue;
    const hasDup = rec.isDuplicateImage || rec.isDuplicateReceipt;
    items.push({
      id: `unregistered-${rec.id}`,
      status: 'no_registrado',
      reason: 'Comprobante presente en minuta que no figura en el listado del sistema',
      matchScore: 0,
      systemMovements: [],
      receipts: [rec],
      hasDuplicateAlert: hasDup,
      duplicateDetails: rec.duplicateReason,
      manualState: 'pendiente',
      categoryIds: [],
      auditorNote: '',
    });
  }

  // Sort: Revisar & Sin respaldo & No registrado first, then Conciliado
  const order: Record<ReconciliationItem['status'], number> = {
    revisar: 0,
    sin_respaldo: 1,
    no_registrado: 2,
    conciliado: 3,
  };

  items.sort((a, b) => order[a.status] - order[b.status]);
  return items;
}
