'use client';

import Link from 'next/link';
import { SCROLLBAR } from './shared';
import { WizardPanel } from './wizard-panel';
import { ResultsPanel } from './results-panel';
import { ReviewPanel } from './review-panel';
import { useGenerateWorkspace } from './use-generate-workspace';

export function GenerateWorkspace({ projectId }: { projectId: string }) {
  const workspace = useGenerateWorkspace(projectId);

  return (
    <div className="space-y-5 rounded-[28px] bg-gradient-to-br from-slate-50 via-white to-blue-50/40 p-1">
      {/* Button quay lại - luôn về trang tổng quan project (cố định, không phụ thuộc history) */}
      <Link
        href={workspace.isDemoProject ? '/projects' : `/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-500 transition-all hover:bg-white hover:text-slate-800 hover:shadow-sm"
      >
        <svg className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Quay lại project
      </Link>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr] h-[calc(100vh-10rem)]">
        <WizardPanel workspace={workspace} />

        {/* ── Right column: tab Kết quả / Review & Enhance ── */}
        <section className="flex flex-col overflow-hidden">
          <div className="mb-4 flex shrink-0 gap-1.5 rounded-2xl border border-slate-200/70 bg-white/90 p-1.5 shadow-sm backdrop-blur-sm">
            <button
              type="button"
              onClick={() => workspace.setRightTab('results')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 ${
                workspace.rightTab === 'results' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm shadow-blue-200' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              Test Cases Generated
              <span className={`rounded-full px-2 py-0.5 text-xs transition-colors ${workspace.rightTab === 'results' ? 'bg-white/20' : 'bg-slate-100'}`}>{workspace.safeTestCasesCount}</span>
            </button>
            <button
              type="button"
              onClick={() => workspace.setRightTab('review')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 ${
                workspace.rightTab === 'review' ? 'bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-sm shadow-purple-200' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              Review & Enhance
              {workspace.review && workspace.rightTab !== 'review' && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" title="Đã có kết quả review" />}
            </button>
          </div>

          <div className={`flex-1 space-y-5 overflow-y-auto pr-1 ${SCROLLBAR}`}>
            {workspace.rightTab === 'results' && <ResultsPanel workspace={workspace} />}
            {workspace.rightTab === 'review' && <ReviewPanel workspace={workspace} />}
          </div>
        </section>
      </div>
    </div>
  );
}
