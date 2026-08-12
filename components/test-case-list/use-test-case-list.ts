'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { TestCaseFormData } from '@/components/test-case-form/types';
import type { TestCase } from './types';

const CATEGORY_BADGE_COLORS: Record<string, string> = {
  positive: 'bg-success-50 text-success-600',
  negative: 'bg-danger-50 text-danger-600',
  boundary: 'bg-warning-50 text-warning-600',
  security: 'bg-brand-50 text-brand-700',
  localization: 'bg-ink-100 text-ink-600',
};

export function categoryBadge(cat: string) {
  return CATEGORY_BADGE_COLORS[cat] || 'bg-ink-100 text-ink-600';
}

/** All state, fetching, and mutation handlers for the test case library page. */
export function useTestCaseList(projectId: string) {
  const { t } = useLanguage();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleCreate = async (data: TestCaseFormData) => {
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

  return {
    t, projectId,
    cases, loading, showCreate, setShowCreate,
    selectedIds, toggleSelect, toggleSelectAll,
    page, setPage, pageSize, handlePageSizeChange,
    paginatedCases, totalPages,
    handleCreate, handleStatusChange, handleExport, handleBulkDelete,
    refresh: fetchCases,
  };
}

export type TestCaseListState = ReturnType<typeof useTestCaseList>;
