'use client';

import type { TestStep } from './types';

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
      <label className="block text-sm font-medium text-gray-700 mb-1">Các bước thực hiện</label>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-gray-500">Bước {step.step_number}</span>
              {steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  Xóa bước
                </button>
              )}
            </div>
            <input
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Hành động"
              value={step.action}
              onChange={(e) => onUpdate(i, 'action', e.target.value)}
            />
            <input
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Kết quả mong đợi của bước này"
              value={step.expected_result}
              onChange={(e) => onUpdate(i, 'expected_result', e.target.value)}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={onAdd}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          + Thêm bước
        </button>
      </div>
    </div>
  );
}
