import * as XLSX from 'xlsx';
import type { AuditCategory, ReconciliationItem } from '../types';

const STATUS_LABELS: Record<ReconciliationItem['status'], string> = {
  conciliado: 'Conciliado',
  revisar: 'Revisar',
  sin_respaldo: 'Sin respaldo',
  no_registrado: 'No registrado',
};

export function exportAuditToExcel(
  items: ReconciliationItem[],
  categories: AuditCategory[] = [],
  filename = 'concilens-auditoria.xlsx'
) {
  const catMap = new Map(categories.map((c) => [c.id, c.name]));

  const rows = items.map((item) => {
    const sys = item.systemMovements[0];
    const rec = item.receipts[0];
    const totalSys = item.systemMovements.reduce((s, m) => s + m.total, 0);
    const totalRec = item.receipts.reduce((s, r) => s + (r.importe ?? 0), 0);
    const catNames = (item.categoryIds ?? [])
      .map((id) => catMap.get(id))
      .filter(Boolean)
      .join(', ');

    return {
      Estado: STATUS_LABELS[item.status],
      Categorias: catNames,
      Observacion_Auditoria: item.auditorNote,
      Motivo: item.reason,
      Alerta_Duplicado: item.hasDuplicateAlert ? item.duplicateDetails || 'SI' : '',
      Fecha_Sistema: sys?.fecha ?? '',
      Nro_Sistema: sys?.numero ?? '',
      Cajero: sys?.cajero ?? '',
      Caja: sys?.caja ?? '',
      Balance: sys?.balance ?? '',
      Razon_Social: sys?.razonSocial ?? '',
      Descripcion_Sistema: sys?.descripcion ?? '',
      Importe_Sistema: item.systemMovements.length > 0 ? totalSys : '',
      Minuta_Archivo: rec?.minutaFile ?? '',
      Imagen_Minuta: rec?.imageName ?? '',
      Posicion_Hoja: rec?.posicion ?? '',
      Fecha_Comprobante: rec?.fecha ?? '',
      Tipo_Comprobante: rec?.tipoComprobante ?? '',
      Nro_Comprobante: item.receipts.map((r) => r.nroComprobante).filter(Boolean).join(' + '),
      Proveedor_Comprobante: item.receipts.map((r) => r.proveedorOConcepto).join(' + '),
      Importe_Comprobante: item.receipts.length > 0 ? totalRec : '',
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Auditoria Concilens');
  XLSX.writeFile(workbook, filename);
}
