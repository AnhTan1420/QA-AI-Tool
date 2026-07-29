'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/language-context';

type TestCaseDetail = {
  id: string;
  code: string;
  title: string;
  category: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'draft' | 'in_review' | 'approved';
  preconditions: string[];
  steps: { step_number: number; action: string; expected_result: string }[];
  expected_result: string | null;
};

export default function TestCaseDetailPage({ params }: { params: Promise<{ projectId: string; caseId: string }> }) {
  const { projectId, caseId } = use(params);
  const router = useRouter();
  const { t } = useLanguage();
  const [testCase, setTestCase] = useState<TestCaseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/test-cases/${caseId}`);
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error ?? t.testCaseDetail.errors.notFound);
        if (mounted) setTestCase(payload.data);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : t.testCaseDetail.errors.loadFailed);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function updateStatus(status: TestCaseDetail['status']) {
    if (!testCase) return;
    const previous = testCase.status;
    setTestCase({ ...testCase, status });
    const response = await fetch('/api/test-cases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: testCase.id, status }),
    });
    if (!response.ok) {
      setTestCase((current) => (current ? { ...current, status: previous } : current));
      const payload = await response.json();
      setError(payload.error ?? t.testCaseDetail.errors.updateFailed);
    }
  }

  async function handleDelete() {
    if (!testCase || !confirm(t.testCaseDetail.deleteConfirm)) return;
    setIsDeleting(true);
    const response = await fetch(`/api/test-cases/${testCase.id}`, { method: 'DELETE' });
    if (response.ok) {
      router.push(`/projects/${projectId}/test-cases`);
    } else {
      const payload = await response.json();
      setError(payload.error ?? t.testCaseDetail.errors.deleteFailed);
      setIsDeleting(false);
    }
  }

  if (loading) {
    return <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">{t.testCaseDetail.loading}</div>;
  }

  if (error && !testCase) {
    return <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-red-700 shadow-sm">{error}</div>;
  }

  if (!testCase) return null;

  return (
    <div className="space-y-6">
      <Link href={`/projects/${projectId}/test-cases`} className="text-sm font-semibold text-blue-600">{t.testCaseDetail.back}</Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">{testCase.code}</span>
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{testCase.priority}</span>
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{testCase.category}</span>
            </div>
            <h1 className="mt-3 text-2xl font-black text-slate-950">{testCase.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <select value={testCase.status} onChange={(e) => updateStatus(e.target.value as TestCaseDetail['status'])} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">
              <option value="draft">{t.testCasesList.statusDraft}</option>
              <option value="in_review">{t.testCasesList.statusInReview}</option>
              <option value="approved">{t.testCasesList.statusApproved}</option>
            </select>
            <button onClick={handleDelete} disabled={isDeleting} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
              {isDeleting ? t.testCaseDetail.deleting : t.testCaseDetail.deleteButton}
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

        {testCase.preconditions?.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">{t.testCaseDetail.preconditions}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {testCase.preconditions.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">{t.testCaseDetail.stepsTitle}</h3>
          <ol className="mt-3 space-y-3">
            {testCase.steps?.map((step) => (
              <li key={step.step_number} className="rounded-2xl bg-slate-50 p-4 text-sm">
                <span className="font-bold text-slate-900">{step.step_number}. {step.action}</span>
                <span className="mt-1 block text-blue-700">{t.testCaseDetail.expectedPrefix}: {step.expected_result}</span>
              </li>
            ))}
          </ol>
        </div>

        {testCase.expected_result && (
          <p className="mt-6 text-sm font-semibold text-emerald-700">{t.testCaseDetail.finalExpectedPrefix}: {testCase.expected_result}</p>
        )}
      </div>

      <div className="rounded-3xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
        {t.testCaseDetail.roadmapNote}
      </div>
    </div>
  );
}
