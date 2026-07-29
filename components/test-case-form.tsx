'use client';

import type { getDictionary } from '@/lib/i18n/dictionaries';
import { useState } from 'react';

type TestStep = {
  step_number: number;
  action: string;
  expected_result: string;
};

type TestCaseFormData = {
  code: string;
  title: string;
  category: string;
  priority: string;
  preconditions: string[];
  test_data: Record<string, string>;
  steps: TestStep[];
  expected_result: string;
  status: string;
};

const CATEGORIES = [
  'positive', 'negative', 'boundary', 'ui_ux', 'compatibility',
  'performance', 'security', 'integration', 'regression', 'accessibility', 'localization',
];

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];

const STATUSES = ['draft', 'in_review', 'approved'];

interface TestCaseFormProps {
  initialData?: Partial<TestCaseFormData>;
  onSubmit: (data: TestCaseFormData) => void;
  onCancel: () => void;
  submitLabel: string;
}

export default function TestCaseForm({ initialData, onSubmit, onCancel, submitLabel }: TestCaseFormProps) {
  const [form, setForm] = useState<TestCaseFormData>({
    code: initialData?.code || '',
    title: initialData?.title || '',
    category: initialData?.category || 'positive',
    priority: initialData?.priority || 'P2',
    preconditions: initialData?.preconditions?.length ? initialData.preconditions : [''],
    test_data: initialData?.test_data || {},
    steps: initialData?.steps?.length
      ? initialData.steps
      : [{ step_number: 1, action: '', expected_result: '' }],
    expected_result: initialData?.expected_result || '',
    status: initialData?.status || 'draft',
  });

  const [testDataKey, setTestDataKey] = useState('');
  const [testDataValue, setTestDataValue] = useState('');

  const updateField = <K extends keyof TestCaseFormData>(field: K, value: TestCaseFormData[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const addStep = () => {
    setForm((prev) => ({
      ...prev,
      steps: [
        ...prev.steps,
        { step_number: prev.steps.length + 1, action: '', expected_result: '' },
      ],
    }));
  };

  const removeStep = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step_number: i + 1 })),
    }));
  };

  const updateStep = (idx: number, field: keyof TestStep, value: string) => {
    setForm((prev) => {
      const next = [...prev.steps];
      next[idx] = { ...next[idx], [field]: value };
      return { ...prev, steps: next };
    });
  };

  const addPrecondition = () => {
    setForm((prev) => ({ ...prev, preconditions: [...prev.preconditions, ''] }));
  };

  const updatePrecondition = (idx: number, value: string) => {
    setForm((prev) => {
      const next = [...prev.preconditions];
      next[idx] = value;
      return { ...prev, preconditions: next };
    });
  };

  const removePrecondition = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      preconditions: prev.preconditions.filter((_, i) => i !== idx),
    }));
  };

  const addTestData = () => {
    if (!testDataKey.trim()) return;
    setForm((prev) => ({
      ...prev,
      test_data: { ...prev.test_data, [testDataKey.trim()]: testDataValue },
    }));
    setTestDataKey('');
    setTestDataValue('');
  };

  const removeTestData = (key: string) => {
    setForm((prev) => {
      const next = { ...prev.test_data };
      delete next[key];
      return { ...prev, test_data: next };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-h-[70vh] overflow-y-auto pr-2">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Mã test case</label>
          <input
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.code}
            onChange={(e) => updateField('code', e.target.value)}
            placeholder="VD: TC_LOGIN_006"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tiêu đề</label>
          <input
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.title}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder="VD: Forgot Password with valid email"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phân loại</label>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.category}
            onChange={(e) => updateField('category', e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.priority}
            onChange={(e) => updateField('priority', e.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Trạng thái</label>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.status}
            onChange={(e) => updateField('status', e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Điều kiện tiên quyết</label>
        <div className="space-y-2">
          {form.preconditions.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={p}
                onChange={(e) => updatePrecondition(i, e.target.value)}
                placeholder={`Precondition ${i + 1}`}
              />
              <button
                type="button"
                onClick={() => removePrecondition(i)}
                className="text-red-500 hover:text-red-700 text-sm px-2"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addPrecondition}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            + Thêm precondition
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Dữ liệu test</label>
        <div className="flex gap-2 mb-2">
          <input
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Key (VD: email)"
            value={testDataKey}
            onChange={(e) => setTestDataKey(e.target.value)}
          />
          <input
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="Value (VD: test@example.com)"
            value={testDataValue}
            onChange={(e) => setTestDataValue(e.target.value)}
          />
          <button
            type="button"
            onClick={addTestData}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium"
          >
            Thêm
          </button>
        </div>
        {Object.entries(form.test_data).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(form.test_data).map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-1 rounded text-xs">
                {k}: {v}
                <button type="button" onClick={() => removeTestData(k)} className="text-blue-400 hover:text-blue-600">✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Các bước thực hiện</label>
        <div className="space-y-3">
          {form.steps.map((step, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-500">Bước {step.step_number}</span>
                {form.steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
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
                onChange={(e) => updateStep(i, 'action', e.target.value)}
              />
              <input
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Kết quả mong đợi của bước này"
                value={step.expected_result}
                onChange={(e) => updateStep(i, 'expected_result', e.target.value)}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={addStep}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            + Thêm bước
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Kết quả mong đợi cuối cùng</label>
        <textarea
          required
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={form.expected_result}
          onChange={(e) => updateField('expected_result', e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
        >
          Hủy
        </button>
        <button
          type="submit"
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}