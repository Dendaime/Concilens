import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { AuditCategory } from '../types';

const SWATCH_COLORS = [
  '#0f766e',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#db2777',
  '#475569',
];

interface CategoryManagerModalProps {
  isOpen: boolean;
  categories: AuditCategory[];
  onClose: () => void;
  onCreateCategory: (name: string, color: string) => void;
  onDeleteCategory: (id: string) => void;
}

export function CategoryManagerModal({
  isOpen,
  categories,
  onClose,
  onCreateCategory,
  onDeleteCategory,
}: CategoryManagerModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(SWATCH_COLORS[0]);

  if (!isOpen) return null;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreateCategory(trimmed, color);
    setName('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Categorías de auditoría</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Creá categorías personalizadas con descripción y color para clasificar y filtrar comprobantes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-xs">
          <div className="space-y-2">
            <label className="block font-semibold text-slate-700">Descripción</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="Ej. Revisado OK, Observar monto, Pendiente remito…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label className="block font-semibold text-slate-700">Color</label>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCH_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={`h-7 w-7 rounded-full transition ${
                    color.toLowerCase() === c.toLowerCase()
                      ? 'ring-2 ring-slate-900 ring-offset-2'
                      : 'opacity-85 hover:opacity-100'
                  }`}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                title="Elegir otro color"
                className="h-8 w-9 cursor-pointer rounded-lg border border-slate-200 p-0.5"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!name.trim()}
              onClick={handleCreate}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Crear categoría
            </button>
          </div>

          {/* Existing categories list */}
          <div className="border-t border-slate-200 pt-3">
            <p className="mb-2 font-semibold text-slate-700">
              Categorías creadas ({categories.length})
            </p>
            {categories.length === 0 ? (
              <p className="text-slate-400">Todavía no creaste ninguna categoría.</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-auto pr-1">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: cat.color }}
                      />
                      <span className="font-medium text-slate-800">{cat.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDeleteCategory(cat.id)}
                      title="Eliminar categoría"
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
