export interface SystemMovement {
  id: string;
  rowIndex: number;
  tipo: string;
  serie: string;
  numero: string;
  fecha: string; // DD/MM/YYYY
  fechaIso: string; // YYYY-MM-DD
  cuenta: string;
  razonSocial: string;
  total: number;
  caja: string;
  cajero: string;
  balance: string;
  descripcion: string;
}

export interface ExtractedImage {
  id: string;
  minutaFile: string;
  minutaDate: string | null; // DD/MM/YYYY parsed from filename
  minutaDateIso: string | null; // YYYY-MM-DD
  imageName: string;
  mimeType: string;
  dataUrl: string;
  sha256: string;
  sizeBytes: number;
  duplicateOf?: string; // minutaFile/imageName if exact image hash repeated
}

export interface ExtractedReceipt {
  id: string;
  imageId: string;
  resolvedImageIndex?: number;
  minutaFile: string;
  minutaDate: string | null;
  minutaDateIso: string | null;
  imageName: string;
  fecha: string | null; // DD/MM/YYYY
  fechaIso: string | null; // YYYY-MM-DD
  importe: number | null;
  proveedorOConcepto: string;
  tipoComprobante: string;
  nroComprobante: string;
  cuit: string | null;
  posicion: string; // arriba, medio, abajo, izquierda, derecha, completa
  legible: boolean;
  notas: string;
  isDuplicateImage: boolean;
  isDuplicateReceipt: boolean;
  duplicateReason?: string;
}

export type AuditStatus =
  | 'validado'
  | 'conciliado'
  | 'revisar'
  | 'sin_respaldo'
  | 'no_registrado';

export type ManualReviewState = 'pendiente' | 'aprobado' | 'observado' | 'rechazado';

export interface LegacyAuditCategory {
  id: string;
  name: string;
  color: string;
}

export interface ReconciliationItem {
  id: string;
  status: AuditStatus;
  reason: string;
  matchScore: number;
  systemMovements: SystemMovement[];
  receipts: ExtractedReceipt[];
  hasDuplicateAlert: boolean;
  duplicateDetails?: string;
  manualState: ManualReviewState;
  auditorNote: string;
  categoryIds?: string[];
}

export interface GeminiConfig {
  apiKey: string;
  model: string;
  dateToleranceDays: number;
  amountTolerance: number;
}
