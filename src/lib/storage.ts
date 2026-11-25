import type {
  ExtractedImage,
  ExtractedReceipt,
  LegacyAuditCategory,
  ReconciliationItem,
  SystemMovement,
} from '../types';

export interface SavedSession {
  version: 1;
  savedAt: string;
  systemFileName: string | null;
  allMovements: SystemMovement[];
  cajeros: string[];
  selectedCajero: string;
  docxFileNames: string[];
  extractedImages: ExtractedImage[];
  extractedReceipts: ExtractedReceipt[];
  pastedJson: string;
  dateToleranceDays: number;
  items: ReconciliationItem[];
  categories?: LegacyAuditCategory[];
}

const DB_NAME = 'concilens_db';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const SESSION_KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB.'));
  });
}

export async function saveSessionToDb(session: SavedSession): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(session, SESSION_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Error al guardar la sesión.'));
    };
  });
}

export async function loadSessionFromDb(): Promise<SavedSession | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(SESSION_KEY);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as SavedSession | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error ?? new Error('Error al cargar la sesión guardada.'));
    };
  });
}

export async function clearSessionInDb(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(SESSION_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Error al limpiar la sesión.'));
    };
  });
}

export function downloadSessionBackup(session: SavedSession): void {
  const blob = new Blob([JSON.stringify(session)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateTag = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `concilens-proyecto-${dateTag}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readSessionBackupFile(file: File): Promise<SavedSession> {
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<SavedSession>;
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.allMovements)) {
    throw new Error('El archivo seleccionado no es un proyecto válido de Concilens.');
  }
  return parsed as SavedSession;
}
