'use client';

import { X } from 'lucide-react';

export function TestDataEditor({
  testData,
  keyValue,
  valueValue,
  onKeyChange,
  onValueChange,
  onAdd,
  onRemove,
}: {
  testData: Record<string, string>;
  keyValue: string;
  valueValue: string;
  onKeyChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div>
      <span className="field-label">Dữ liệu test</span>
      <div className="-mt-1 mb-2 flex gap-2">
        <input
          className="field-input !py-2 text-sm"
          placeholder="Key (VD: email)"
          value={keyValue}
          onChange={(e) => onKeyChange(e.target.value)}
        />
        <input
          className="field-input !py-2 text-sm"
          placeholder="Value (VD: test@example.com)"
          value={valueValue}
          onChange={(e) => onValueChange(e.target.value)}
        />
        <button type="button" onClick={onAdd} className="btn-secondary btn-sm shrink-0">
          Thêm
        </button>
      </div>
      {Object.entries(testData).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(testData).map(([k, v]) => (
            <span key={k} className="badge-brand">
              {k}: {v}
              <button type="button" onClick={() => onRemove(k)} className="text-brand-400 transition-colors hover:text-brand-700">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
