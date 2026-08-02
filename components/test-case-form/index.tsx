'use client';

import { useState } from 'react';
import { CATEGORIES, PRIORITIES, STATUSES } from './constants';
import { PreconditionsEditor } from './preconditions-editor';
import { TestDataEditor } from './test-data-editor';
import { StepsEditor } from './steps-editor';
import type { TestCaseFormData, TestCaseFormProps, TestStep } from './types';

export default function TestCaseForm({ initialData, onSubmit, onCancel, submitLabel }: TestCaseFormProps) {
  const [form, setForm] = useState<TestCaseFormData>({
    code: initialData?.code || '',
    title: initialData?.title || '',
    category: initialData?.category || 'positive',
    priority: initialData?.priority || 'Major',
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

      <PreconditionsEditor
        preconditions={form.preconditions}
        onUpdate={updatePrecondition}
        onAdd={addPrecondition}
        onRemove={removePrecondition}
      />

      <TestDataEditor
        testData={form.test_data}
        keyValue={testDataKey}
        valueValue={testDataValue}
        onKeyChange={setTestDataKey}
        onValueChange={setTestDataValue}
        onAdd={addTestData}
        onRemove={removeTestData}
      />

      <StepsEditor steps={form.steps} onUpdate={updateStep} onAdd={addStep} onRemove={removeStep} />

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
