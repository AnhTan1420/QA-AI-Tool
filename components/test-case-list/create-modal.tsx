'use client';

import TestCaseForm from '@/components/test-case-form';
import type { TestCaseListState } from './use-test-case-list';

export function CreateModal({ list }: { list: TestCaseListState }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
        <h2 className="text-lg font-bold mb-4">{list.t.testCasesList.createModalTitle}</h2>
        <TestCaseForm
          onSubmit={list.handleCreate}
          onCancel={() => list.setShowCreate(false)}
          submitLabel={list.t.testCasesList.createModalSubmit}
        />
      </div>
    </div>
  );
}
