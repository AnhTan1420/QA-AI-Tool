'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Download, Plus, PlayCircle } from 'lucide-react';
import { useTestCaseList } from '@/hooks/test-case-list/use-test-case-list';
import { CreateModal } from '@/views/test-case-list/create-modal';
import { BulkDeleteBar } from '@/views/test-case-list/bulk-delete-bar';
import { TestCaseTable } from '@/views/test-case-list/test-case-table';
import { PaginationBar } from '@/views/test-case-list/pagination-bar';
import { RunAutomationModal } from '@/views/project-automation/run-automation-modal';
import { BackLink } from '@/views/layout/back-link';

export default function TestCaseLibraryPage() {
  const { projectId } = useParams() as { projectId: string };
  const list = useTestCaseList(projectId);
  const { t } = list;
  const [showRunAutomation, setShowRunAutomation] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <BackLink href={`/projects/${projectId}`} label={t.testCasesList.backToProject} title={t.testCasesList.backToProjectTitle} />
          <p className="text-eyebrow mt-4">{t.testCasesList.eyebrow}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {list.selectedIds.size > 0 && (
            <button onClick={() => setShowRunAutomation(true)} className="btn-success">
              <PlayCircle className="h-4 w-4" />
              {t.testCasesList.runAutomationButton(list.selectedIds.size)}
            </button>
          )}
          <button onClick={list.handleExport} className="btn-secondary">
            <Download className="h-4 w-4" />
            {t.testCasesList.exportButton}
          </button>
          <button onClick={() => list.setShowCreate(true)} className="btn-primary">
            <Plus className="h-4 w-4" />
            {t.testCasesList.createButton}
          </button>
        </div>
      </div>

      {list.showCreate && <CreateModal list={list} />}

      {showRunAutomation && (
        <RunAutomationModal
          projectId={projectId}
          testCaseIds={Array.from(list.selectedIds)}
          onClose={() => {
            setShowRunAutomation(false);
            list.refresh(); // re-fetch so automation_status badges + selection reset
          }}
        />
      )}

      {list.selectedIds.size > 0 && <BulkDeleteBar list={list} />}

      <div className="surface-card overflow-hidden">
        <TestCaseTable list={list} />
        {!list.loading && list.cases.length > 0 && <PaginationBar list={list} />}
      </div>
    </div>
  );
}
