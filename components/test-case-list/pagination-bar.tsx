'use client';

import type { TestCaseListState } from './use-test-case-list';

export function PaginationBar({ list }: { list: TestCaseListState }) {
  const { t } = list;

  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span>{t.testCasesList.paginationShowLabel}</span>
        <select
          value={list.pageSize}
          onChange={(e) => list.handlePageSizeChange(Number(e.target.value))}
          className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t.testCasesList.paginationPrev}
        </button>

        <div className="flex items-center gap-1">
          {Array.from({ length: list.totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => list.setPage(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium ${
                p === list.page
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={() => list.setPage((p) => Math.min(list.totalPages, p + 1))}
          disabled={list.page === list.totalPages}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t.testCasesList.paginationNext}
        </button>
      </div>
    </div>
  );
}
