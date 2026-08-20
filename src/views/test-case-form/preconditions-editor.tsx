'use client';

import { Plus, X } from 'lucide-react';

export function PreconditionsEditor({
  preconditions,
  onUpdate,
  onAdd,
  onRemove,
}: {
  preconditions: string[];
  onUpdate: (idx: number, value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <span className="field-label">Điều kiện tiên quyết</span>
      <div className="mt-1 space-y-2">
        {preconditions.map((p, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="field-input !py-2 text-sm"
              value={p}
              onChange={(e) => onUpdate(i, e.target.value)}
              placeholder={`Precondition ${i + 1}`}
            />
            <button type="button" onClick={() => onRemove(i)} className="icon-btn shrink-0 !text-danger-600 hover:!bg-danger-50 hover:!text-red-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700">
          <Plus className="h-3.5 w-3.5" />
          Thêm precondition
        </button>
      </div>
    </div>
  );
}
