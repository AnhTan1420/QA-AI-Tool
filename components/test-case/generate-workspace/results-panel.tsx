'use client';

import type { TestCaseCategory } from '@/lib/validators/test-case';
import { TestCaseCard } from './test-case-card';
import type { GenerateWorkspaceState } from './use-generate-workspace';

/** Right column, "results" tab: the generated test cases, grouped by category. */
export function ResultsPanel({ workspace }: { workspace: GenerateWorkspaceState }) {
  const { t } = workspace;

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_2px_20px_-4px_rgba(15,23,42,0.06)] backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-600">{t.generateWorkspace.generatedSetEyebrow}</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{workspace.safeTestCasesCount} {t.generateWorkspace.testCasesSuffix}</h2>
        </div>
        {workspace.review && (
          <div className="rounded-2xl bg-slate-50 px-4 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t.generateWorkspace.coverageLabel}</p>
            <p className={`text-3xl font-black ${workspace.coverageTone}`}>{workspace.review.coverage_score}%</p>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-5">
        {Object.entries(workspace.groupedCases).map(([category, items]) => (
          <div key={category}>
            <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">{workspace.getCategoryLabel(category as TestCaseCategory)}</h3>
            <div className="space-y-3">
              {(items ?? []).map((testCase) => <TestCaseCard key={`${testCase?.code}-${testCase?.title}`} testCase={testCase} />)}
            </div>
          </div>
        ))}
        {workspace.safeTestCasesCount === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-10 text-center text-slate-500">
            <svg className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm">{t.generateWorkspace.emptyState}</span>
          </div>
        )}
        {workspace.safeTestCasesCount > 0 && (
          <button
            type="button"
            onClick={() => workspace.setRightTab('review')}
            className="w-full rounded-2xl border border-dashed border-purple-200 bg-purple-50/50 py-3 text-sm font-bold text-purple-700 transition-all hover:border-purple-300 hover:bg-purple-50 hover:shadow-sm"
          >
            Bộ test case đã sẵn sàng → Chuyển sang Review & Enhance
          </button>
        )}
      </div>
    </div>
  );
}
