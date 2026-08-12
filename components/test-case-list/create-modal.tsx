'use client';

import TestCaseForm from '@/components/test-case-form';
import type { TestCaseListState } from './use-test-case-list';

export function CreateModal({ list }: { list: TestCaseListState }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm">
      <div className="surface-card w-full max-w-2xl animate-[fadeIn_0.2s_ease] p-6">
        <h2 className="text-h3 mb-4">{list.t.testCasesList.createModalTitle}</h2>
        <TestCaseForm
          onSubmit={list.handleCreate}
          onCancel={() => list.setShowCreate(false)}
          submitLabel={list.t.testCasesList.createModalSubmit}
        />
      </div>
    </div>
  );
}
