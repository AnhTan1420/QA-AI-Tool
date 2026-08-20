'use client';

import type { TestCaseListState } from '@/hooks/test-case-list/use-test-case-list';

export function PaginationBar({ list }: { list: TestCaseListState }) {
  const { t } = list;

  return (
    <div className="flex items-center justify-between border-t border-ink-100 px-6 py-4">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <span>{t.testCasesList.paginationShowLabel}</span>
        <select
          value={list.pageSize}
          onChange={(e) => list.handlePageSizeChange(Number(e.target.value))}
          className="field-input !w-auto !py-1.5 text-sm"
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
        <span>{t.testCasesList.paginationPerPage} · {list.cases.length} {t.testCasesList.paginationTotalSuffix}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => list.setPage((p) => Math.max(1, p - 1))}
          disabled={list.page === 1}
          className="btn-secondary btn-sm"
        >
          {t.testCasesList.paginationPrev}
        </button>

        <div className="flex items-center gap-1">
          {Array.from({ length: list.totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => list.setPage(p)}
              className={`h-8 w-8 rounded-lg text-sm font-medium transition-colors ${
                p === list.page ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={() => list.setPage((p) => Math.min(list.totalPages, p + 1))}
          disabled={list.page === list.totalPages}
          className="btn-secondary btn-sm"
        >
          {t.testCasesList.paginationNext}
        </button>
      </div>
    </div>
  );
}
