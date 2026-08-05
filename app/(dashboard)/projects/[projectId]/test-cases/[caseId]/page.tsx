'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import TestCaseForm from '@/components/test-case-form';
import { getPriorityStyle } from '@/lib/test-case-taxonomy';
import VersionHistory from '@/components/test-case/version-history';
import CommentsPanel from '@/components/test-case/comments-panel';
import { AutomationPanel, useAutomation } from '@/components/automation';

type TestCase = {
  id: string;
  set_id: string;
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

type Tab = 'details' | 'versions' | 'comments' | 'automation';

export default function TestCaseDetailPage() {
  const { t } = useLanguage();
  const { projectId, caseId } = useParams() as { projectId: string; caseId: string };
  const router = useRouter();
  const [tc, setTc] = useState<TestCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('details');

  const automation = useAutomation(caseId, projectId, tc?.set_id ?? '');

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

  const handleUpdate = async (data: unknown) => {
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

  if (loading) return <div className="p-6 text-gray-500">{t.common.loading}</div>;
  if (!tc) return <div className="p-6 text-red-500">{t.testCaseDetail.notFound}</div>;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'details', label: t.testCaseDetail.tabDetails },
    { id: 'versions', label: t.testCaseDetail.tabVersions },
    { id: 'comments', label: t.testCaseDetail.tabComments },
    { id: 'automation', label: t.automation.title },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link
        href={`/projects/${projectId}/test-cases`}
        className="text-sm text-blue-600 hover:text-blue-800 mb-4 inline-flex items-center gap-1"
      >
        {t.testCaseDetail.back}
      </Link>

      <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-200 pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              activeTab === tab.id ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'details' && (
        <>
          {isEditing ? (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-bold mb-4">{t.testCaseDetail.editTitle}</h2>
              <TestCaseForm
                initialData={tc}
                onSubmit={handleUpdate}
                onCancel={() => setIsEditing(false)}
                submitLabel={t.testCaseDetail.saveChanges}
              />
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">{tc.code}</span>
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${getPriorityStyle(tc.priority)}`}>{tc.priority}</span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs capitalize">{tc.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
                  >
                    {t.testCaseDetail.editButton}
                  </button>
                  <button
                    onClick={handleDelete}
                    className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"
                  >
                    {t.testCaseDetail.deleteButton}
                  </button>
                </div>
              </div>

              <h1 className="text-xl font-bold text-gray-900">{tc.title}</h1>

              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t.testCaseDetail.preconditionsHeading}</h3>
                <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                  {tc.preconditions?.length ? tc.preconditions.map((p, i) => (
                    <li key={i}>{p}</li>
                  )) : <li className="text-gray-400 italic">{t.testCaseDetail.noPreconditions}</li>}
                </ul>
              </div>

              <div>
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">{t.testCaseDetail.stepsHeading}</h3>
                <div className="space-y-3">
                  {tc.steps.map((step) => (
                    <div key={step.step_number} className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm font-semibold text-gray-900 mb-1">
                        {step.step_number}. {step.action}
                      </p>
                      <p className="text-sm text-blue-600">
                        {t.testCaseDetail.expectedPrefix}: {step.expected_result}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-green-800 mb-1">{t.testCaseDetail.finalExpectedHeading}</p>
                <p className="text-sm text-green-700">{tc.expected_result}</p>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'versions' && (
        <VersionHistory testCaseId={tc.id} current={tc} />
      )}

      {activeTab === 'comments' && (
        <CommentsPanel testCaseId={tc.id} />
      )}

      {activeTab === 'automation' && tc.set_id && (
        <AutomationPanel automation={automation} />
      )}
    </div>
  );
}
