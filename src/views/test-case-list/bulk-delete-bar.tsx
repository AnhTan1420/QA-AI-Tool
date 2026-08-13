'use client';

import { Trash2 } from 'lucide-react';
import type { TestCaseListState } from '@/hooks/test-case-list/use-test-case-list';

export function BulkDeleteBar({ list }: { list: TestCaseListState }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-[var(--radius-control)] border border-danger-600/20 bg-danger-50 px-4 py-3">
      <span className="text-sm font-semibold text-danger-600">{list.t.testCasesList.bulkDeleteLabel(list.selectedIds.size)}</span>
      <button onClick={list.handleBulkDelete} className="btn-danger btn-sm">
        <Trash2 className="h-3.5 w-3.5" />
        {list.t.testCasesList.bulkDeleteButton}
      </button>
    </div>
  );
}
