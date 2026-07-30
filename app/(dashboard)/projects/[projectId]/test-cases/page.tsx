'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import TestCaseForm from '@/components/test-case-form';
import { getPriorityStyle } from '@/lib/test-case-taxonomy';

type TestCase = {
  id: string;
  code: string;
  title: string;
  category: string;
  priority: string;
  status: string;
};

export default function TestCaseLibraryPage() {
  const { t } = useLanguage();
  const { projectId } = useParams() as { projectId: string };
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchCases = async () => {
    setLoading(true);
    const res = await fetch(`/api/test-cases?projectId=${projectId}`);
    const json = await res.json();
    if (json.success) {
      // Sắp xếp theo code tăng dần (TC_LOGIN_001 -> TC_LOGIN_002)
      const sorted = (json.data as TestCase[]).sort((a, b) => a.code.localeCompare(b.code));
      setCases(sorted);
    }
    setLoading(false);
    setSelectedIds(new Set());
    setPage(1);
  };

  useEffect(() => {
    fetchCases();
  }, [projectId]);

  // Reset về trang 1 khi đổi pageSize
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  // Dữ liệu phân trang
  const paginatedCases = useMemo(() => {
    const start = (page - 1) * pageSize;
    return cases.slice(start, start + pageSize);
  }, [cases, page, pageSize]);

  const totalPages = Math.ceil(cases.length / pageSize) || 1;

  const handleCreate = async (data: any) => {
    const res = await fetch('/api/test-cases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, project_id: projectId }),
    });
    const json = await res.json();
    if (json.success) {
      setShowCreate(false);
      fetchCases();
    } else {
      alert(json.error);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    const res = await fetch('/api/test-cases', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) fetchCases();
  };

  const handleExport = () => {
    window.open(`/api/test-cases/export?projectId=${projectId}`, '_blank');
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedCases.length && paginatedCases.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedCases.map((c) => c.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(t.testCasesList.bulkDeleteConfirm(selectedIds.size))) return;

    const res = await fetch('/api/test-cases', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    });

    if (res.ok) {
      fetchCases();
    } else {
      const json = await res.json();
      alert(json.error || 'Xóa thất bại');
    }
  };

  const categoryBadge = (cat: string) => {
    const colors: Record<string, string> = {
      positive: 'bg-green-100 text-green-700',
      negative: 'bg-red-100 text-red-700',
      boundary: 'bg-yellow-100 text-yellow-700',
      security: 'bg-purple-100 text-purple-700',
      localization: 'bg-pink-100 text-pink-700',
    };
    return colors[cat] || 'bg-gray-100 text-gray-700';
  };

  const selectedCount = selectedIds.size;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href={`/projects/${projectId}`}
              className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1 transition-colors"
              title={t.testCasesList.backToProjectTitle}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              {t.testCasesList.backToProject}
            </Link>
          </div>
          <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider mb-1">{t.testCasesList.eyebrow}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleExport}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t.testCasesList.exportButton}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            {t.testCasesList.createButton}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
            <h2 className="text-lg font-bold mb-4">{t.testCasesList.createModalTitle}</h2>
            <TestCaseForm
              onSubmit={handleCreate}
              onCancel={() => setShowCreate(false)}
              submitLabel={t.testCasesList.createModalSubmit}
            />
          </div>
        </div>
      )}

      {selectedCount > 0 && (
        <div className="mb-4 flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <span className="text-sm text-red-700 font-medium">{t.testCasesList.bulkDeleteLabel(selectedCount)}</span>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {t.testCasesList.bulkDeleteButton}
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 font-medium">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={paginatedCases.length > 0 && paginatedCases.every((c) => selectedIds.has(c.id))}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
                <th className="text-left px-6 py-3">{t.testCasesList.colCode}</th>
              <th className="text-left px-6 py-3">{t.testCasesList.colTitle}</th>
              <th className="text-left px-6 py-3">{t.testCasesList.colCategory}</th>
              <th className="text-left px-6 py-3">{t.testCasesList.colPriority}</th>
              <th className="text-left px-6 py-3">{t.testCasesList.colStatus}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">{t.testCasesList.loading}</td>
              </tr>
            ) : paginatedCases.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">{t.testCasesList.empty}</td>
              </tr>
            ) : (
              paginatedCases.map((tc) => (
                <tr key={tc.id} className={`hover:bg-gray-50 ${selectedIds.has(tc.id) ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(tc.id)}
                      onChange={() => toggleSelect(tc.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <Link href={`/projects/${projectId}/test-cases/${tc.id}`} className="text-blue-600 font-medium hover:underline">
                      {tc.code}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-900">{tc.title}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${categoryBadge(tc.category)}`}>
                      {tc.category}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${getPriorityStyle(tc.priority)}`}>{tc.priority}</span>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={tc.status}
                      onChange={(e) => handleStatusChange(tc.id, e.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="draft">{t.testCasesList.statusDraft}</option>
                      <option value="in_review">{t.testCasesList.statusInReview}</option>
                      <option value="approved">{t.testCasesList.statusApproved}</option>
                    </select>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {!loading && cases.length > 0 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>{t.testCasesList.paginationShowLabel}</span>
              <select
                value={pageSize}
                onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>{t.testCasesList.paginationPerPage} · {cases.length} {t.testCasesList.paginationTotalSuffix}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.testCasesList.paginationPrev}
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium ${
                      p === page
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t.testCasesList.paginationNext}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
