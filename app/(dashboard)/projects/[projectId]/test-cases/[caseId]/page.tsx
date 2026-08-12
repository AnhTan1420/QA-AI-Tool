'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Pencil, Trash2, CheckCircle2, CornerDownRight, History, Bot } from 'lucide-react';
import TestCaseForm from '@/components/test-case-form';
import { getPriorityStyle } from '@/lib/test-case-taxonomy';
import VersionHistory from '@/components/test-case/version-history';
import CommentsPanel from '@/components/test-case/comments-panel';
import AutomationPanel from '@/components/test-case/automation-panel';
import { BackLink } from '@/components/layout/back-link';

type TestCase = {
  id: string;
  code: string;
  title: string;
  category: string;
  priority: string;
  preconditions: string[];
  test_data: Record<string, string>;
  steps: { step_number: number; action: string; expected_result: string }[];
  expected_result: string;
  status: string;
};

export default function TestCaseDetailPage() {
  const { t } = useLanguage();
  const { projectId, caseId } = useParams() as { projectId: string; caseId: string };
  const router = useRouter();
  const [tc, setTc] = useState<TestCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'history' | 'automation'>('history');

  const fetchDetail = async () => {
    setLoading(true);
    const res = await fetch(`/api/test-cases/${caseId}`);
    const json = await res.json();
    if (json.success) setTc(json.data);
    setLoading(false);
  };

  useEffect(() => {
    fetchDetail();
  }, [caseId]);

  const handleUpdate = async (data: any) => {
    const res = await fetch(`/api/test-cases/${caseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.success) {
      setIsEditing(false);
      fetchDetail();
    } else {
      alert(json.error);
    }
  };

  const handleDelete = async () => {
    if (!confirm(t.testCaseDetail.deleteConfirm)) return;
    const res = await fetch(`/api/test-cases/${caseId}`, { method: 'DELETE' });
    if (res.ok) {
      router.push(`/projects/${projectId}/test-cases`);
    }
  };

  if (loading) return <p className="text-caption">{t.common.loading}</p>;
  if (!tc) return <div className="alert-danger">{t.testCaseDetail.notFound}</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href={`/projects/${projectId}/test-cases`} label={t.testCaseDetail.back} />

      {isEditing ? (
        <div className="surface-card p-6">
          <h2 className="text-h3 mb-4">{t.testCaseDetail.editTitle}</h2>
          <TestCaseForm
            initialData={tc}
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
            submitLabel={t.testCaseDetail.saveChanges}
          />
        </div>
      ) : (
        <div className="surface-card space-y-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge-brand font-mono">{tc.code}</span>
              <span className={`rounded px-2 py-1 text-xs font-semibold ${getPriorityStyle(tc.priority)}`}>{tc.priority}</span>
              <span className="badge-neutral capitalize">{tc.category}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsEditing(true)} className="btn-secondary btn-sm">
                <Pencil className="h-3.5 w-3.5" />
                {t.testCaseDetail.editButton}
              </button>
              <button onClick={handleDelete} className="btn-secondary btn-sm !text-danger-600 hover:!bg-danger-50">
                <Trash2 className="h-3.5 w-3.5" />
                {t.testCaseDetail.deleteButton}
              </button>
            </div>
          </div>

          <h1 className="text-h2">{tc.title}</h1>

          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">{t.testCaseDetail.preconditionsHeading}</h3>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink-700">
              {tc.preconditions?.length ? tc.preconditions.map((p, i) => (
                <li key={i}>{p}</li>
              )) : <li className="italic text-ink-400">{t.testCaseDetail.noPreconditions}</li>}
            </ul>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">{t.testCaseDetail.stepsHeading}</h3>
            <div className="space-y-2">
              {tc.steps.map((step) => (
                <div key={step.step_number} className="rounded-[var(--radius-control)] bg-ink-50 p-3">
                  <div className="flex gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[10px] font-bold text-ink-600">{step.step_number}</span>
                    <span className="text-sm font-semibold text-ink-800">{step.action}</span>
                  </div>
                  <span className="mt-1.5 flex items-start gap-1.5 pl-7 text-sm text-brand-700">
                    <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{t.testCaseDetail.expectedPrefix}: {step.expected_result}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="flex items-start gap-1.5 rounded-[var(--radius-control)] border border-success-600/20 bg-success-50 px-3 py-2 text-sm font-semibold text-success-600">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t.testCaseDetail.finalExpectedHeading}: {tc.expected_result}</span>
          </p>
        </div>
      )}

      {!isEditing && (
        <div>
          <div className="mb-4 flex gap-1 rounded-[var(--radius-control)] border border-ink-200 bg-white p-1 shadow-[var(--shadow-soft)]">
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
                activeTab === 'history' ? 'bg-brand-600 text-white shadow-[var(--shadow-soft)]' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
              }`}
            >
              <History className="h-4 w-4" strokeWidth={2.25} />
              {t.testCaseDetail.historyTabLabel}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('automation')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 ${
                activeTab === 'automation' ? 'bg-brand-600 text-white shadow-[var(--shadow-soft)]' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
              }`}
            >
              <Bot className="h-4 w-4" strokeWidth={2.25} />
              {t.automation.tabTitle}
            </button>
          </div>

          {activeTab === 'history' ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <VersionHistory testCaseId={tc.id} current={tc} />
              <CommentsPanel testCaseId={tc.id} />
            </div>
          ) : (
            <AutomationPanel
              testCase={{
                id: tc.id,
                title: tc.title,
                preconditions: tc.preconditions ?? [],
                steps: tc.steps,
                expected_result: tc.expected_result,
              }}
              projectId={projectId}
            />
          )}
        </div>
      )}
    </div>
  );
}
