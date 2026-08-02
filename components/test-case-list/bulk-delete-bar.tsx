'use client';

import type { TestCaseListState } from './use-test-case-list';

export function BulkDeleteBar({ list }: { list: TestCaseListState }) {
  return (
    <div className="mb-4 flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-4 py-3">
      <span className="text-sm text-red-700 font-medium">{list.t.testCasesList.bulkDeleteLabel(list.selectedIds.size)}</span>
      <button
        onClick={list.handleBulkDelete}
        className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        {list.t.testCasesList.bulkDeleteButton}
      </button>
    </div>
  );
}
