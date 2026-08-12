'use client';

import { useState } from 'react';
import { CATEGORIES, PRIORITIES, STATUSES } from './constants';
import { PreconditionsEditor } from './preconditions-editor';
import { TestDataEditor } from './test-data-editor';
import { StepsEditor } from './steps-editor';
import type { TestCaseFormData, TestCaseFormProps, TestStep } from './types';
import { SCROLLBAR } from '@/components/test-case/generate-workspace/shared';

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
    <form onSubmit={handleSubmit} className={`max-h-[70vh] space-y-5 overflow-y-auto pr-2 ${SCROLLBAR}`}>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="field-label">Mã test case</span>
          <input
            required
            className="field-input"
            value={form.code}
            onChange={(e) => updateField('code', e.target.value)}
            placeholder="VD: TC_LOGIN_006"
          />
        </label>
        <label className="block">
          <span className="field-label">Tiêu đề</span>
          <input
            required
            className="field-input"
            value={form.title}
            onChange={(e) => updateField('title', e.target.value)}
            placeholder="VD: Forgot Password with valid email"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <label className="block">
          <span className="field-label">Phân loại</span>
          <select className="field-input" value={form.category} onChange={(e) => updateField('category', e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Priority</span>
          <select className="field-input" value={form.priority} onChange={(e) => updateField('priority', e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="field-label">Trạng thái</span>
          <select className="field-input" value={form.status} onChange={(e) => updateField('status', e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
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

      <label className="block">
        <span className="field-label">Kết quả mong đợi cuối cùng</span>
        <textarea
          required
          rows={3}
          className="field-input"
          value={form.expected_result}
          onChange={(e) => updateField('expected_result', e.target.value)}
        />
      </label>

      <div className="flex justify-end gap-3 border-t border-ink-100 pt-4">
        <button type="button" onClick={onCancel} className="btn-secondary">
          Hủy
        </button>
        <button type="submit" className="btn-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
