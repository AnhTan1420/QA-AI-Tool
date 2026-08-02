'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useTestCaseList } from '@/components/test-case-list/use-test-case-list';
import { CreateModal } from '@/components/test-case-list/create-modal';
import { BulkDeleteBar } from '@/components/test-case-list/bulk-delete-bar';
import { TestCaseTable } from '@/components/test-case-list/test-case-table';
import { PaginationBar } from '@/components/test-case-list/pagination-bar';

export default function TestCaseLibraryPage() {
  const { projectId } = useParams() as { projectId: string };
  const list = useTestCaseList(projectId);
  const { t } = list;

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
            onClick={list.handleExport}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t.testCasesList.exportButton}
          </button>
          <button
            onClick={() => list.setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            {t.testCasesList.createButton}
          </button>
        </div>
      </div>

      {list.showCreate && <CreateModal list={list} />}

      {list.selectedIds.size > 0 && <BulkDeleteBar list={list} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <TestCaseTable list={list} />
        {!list.loading && list.cases.length > 0 && <PaginationBar list={list} />}
      </div>
    </div>
  );
}
