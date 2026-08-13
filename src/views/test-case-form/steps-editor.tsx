'use client';

import { Plus, X } from 'lucide-react';
import type { TestStep } from '@/models/types/test-case-form';

export function StepsEditor({
  steps,
  onUpdate,
  onAdd,
  onRemove,
}: {
  steps: TestStep[];
  onUpdate: (idx: number, field: keyof TestStep, value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <span className="field-label">Các bước thực hiện</span>
      <div className="mt-1 space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="space-y-2 rounded-[var(--radius-control)] border border-ink-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-500">Bước {step.step_number}</span>
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="flex items-center gap-1 text-xs font-semibold text-danger-600 transition-colors hover:text-red-700"
                >
                  <X className="h-3 w-3" />
                  Xóa bước
                </button>
              )}
            </div>
            <input
              required
              className="field-input !py-2 text-sm"
              placeholder="Hành động"
              value={step.action}
              onChange={(e) => onUpdate(i, 'action', e.target.value)}
            />
            <input
              required
              className="field-input !py-2 text-sm"
              placeholder="Kết quả mong đợi của bước này"
              value={step.expected_result}
              onChange={(e) => onUpdate(i, 'expected_result', e.target.value)}
            />
          </div>
        ))}
        <button type="button" onClick={onAdd} className="flex items-center gap-1 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700">
          <Plus className="h-3.5 w-3.5" />
          Thêm bước
        </button>
      </div>
    </div>
  );
}
