'use client';

import Link from 'next/link';
import { useEffect, useState, use } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

type TestCaseRow = {
  id: string;
  code: string;
  title: string;
  category: string;
  priority: 'P1' | 'P2' | 'P3' | 'P4';
  status: 'draft' | 'in_review' | 'approved';
  expected_result?: string | null;
};

export default function TestCasesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { t } = useLanguage();
  const [testCases, setTestCases] = useState<TestCaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    async function fetchTestCases() {
      if (projectId === 'demo') {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/test-cases?projectId=${encodeURIComponent(projectId)}`);
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.error ?? t.testCasesList.errors.loadFailed);
        }
        if (mounted) setTestCases(result.data ?? []);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : t.testCasesList.errors.loadFailed);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchTestCases();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function updateStatus(id: string, status: TestCaseRow['status']) {
    const previous = testCases;
    setTestCases((current) => current.map((testCase) => (testCase.id === id ? { ...testCase, status } : testCase)));

    const response = await fetch('/api/test-cases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });

    if (!response.ok) {
      setTestCases(previous);
      const result = await response.json();
      setError(result.error ?? t.testCasesList.errors.updateFailed);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{t.testCasesList.eyebrow}</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">{t.testCasesList.titlePrefix} {projectId}</h1>
          <p className="mt-2 text-slate-600">{t.testCasesList.subtitle}</p>
        </div>
        <Link href={`/projects/${projectId}/generate`} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700">
          {t.testCasesList.generateNew}
        </Link>
      </div>

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

      {projectId === 'demo' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
          {t.testCasesList.demoNotice}
        </div>
      )}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
          <span>{t.testCasesList.colCode}</span>
          <span>{t.testCasesList.colTitle}</span>
          <span>{t.testCasesList.colCategory}</span>
          <span>{t.testCasesList.colPriority}</span>
          <span>{t.testCasesList.colStatus}</span>
        </div>
        {loading && <div className="p-8 text-center text-slate-500">{t.testCasesList.loading}</div>}
        {!loading && testCases.length === 0 && <div className="p-8 text-center text-slate-500">{t.testCasesList.empty}</div>}
        {testCases.map((testCase) => (
          <div key={testCase.id} className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-slate-100 px-5 py-4 text-sm last:border-b-0">
            <Link href={`/projects/${projectId}/test-cases/${testCase.id}`} className="font-mono font-bold text-blue-700">{testCase.code}</Link>
            <span className="font-semibold text-slate-950">{testCase.title}</span>
            <span className="text-slate-600">{testCase.category}</span>
            <span className="font-bold text-slate-700">{testCase.priority}</span>
            <select value={testCase.status} onChange={(event) => updateStatus(testCase.id, event.target.value as TestCaseRow['status'])} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <option value="draft">{t.testCasesList.statusDraft}</option>
              <option value="in_review">{t.testCasesList.statusInReview}</option>
              <option value="approved">{t.testCasesList.statusApproved}</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
