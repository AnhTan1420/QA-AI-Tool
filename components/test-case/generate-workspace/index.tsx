'use client';

import Link from 'next/link';
import { ArrowLeft, ListChecks, Wand2 } from 'lucide-react';
import { SCROLLBAR } from './shared';
import { WizardPanel } from './wizard-panel';
import { ResultsPanel } from './results-panel';
import { ReviewPanel } from './review-panel';
import { GeneratingModal } from './generating-modal';
import { useGenerateWorkspace } from './use-generate-workspace';

export function GenerateWorkspace({ projectId }: { projectId: string }) {
  const workspace = useGenerateWorkspace(projectId);
  const { t } = workspace;

  return (
    <div className="space-y-5">
      <GeneratingModal workspace={workspace} />

      {/* Nut quay lai - luon ve trang tong quan project (co dinh, khong phu thuoc history) */}
      <Link
        href={workspace.isDemoProject ? '/projects' : `/projects/${projectId}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 transition-colors hover:text-brand-700"
      >
        <ArrowLeft className="h-4 w-4" />
        {t.generateWorkspace.backToProject}
      </Link>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr] xl:h-[calc(100vh-10rem)]">
        <WizardPanel workspace={workspace} />

        {/* ── Cot phai: tab Ket qua / Review & Enhance ── */}
        <section className="flex flex-col overflow-hidden">
          <div className="mb-4 flex shrink-0 gap-1 rounded-[var(--radius-control)] border border-ink-200 bg-white p-1 shadow-[var(--shadow-soft)]">
            <button
              type="button"
              onClick={() => workspace.setRightTab('results')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-[0.625rem] px-4 py-2.5 text-sm font-semibold transition-all duration-150 ${
                workspace.rightTab === 'results' ? 'bg-brand-600 text-white shadow-[var(--shadow-soft)]' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
              }`}
            >
              <ListChecks className="h-4 w-4 shrink-0" strokeWidth={2.25} />
              {t.generateWorkspace.tabs.results}
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${workspace.rightTab === 'results' ? 'bg-white/20' : 'bg-ink-100 text-ink-500'}`}>
                {workspace.safeTestCasesCount}
              </span>
              {workspace.isPending && <span className="h-2 w-2 animate-pulse rounded-full bg-brand-300" title={t.generateWorkspace.tabs.generatingTooltip} />}
            </button>
            <button
              type="button"
              onClick={() => workspace.setRightTab('review')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-[0.625rem] px-4 py-2.5 text-sm font-semibold transition-all duration-150 ${
                workspace.rightTab === 'review' ? 'bg-brand-600 text-white shadow-[var(--shadow-soft)]' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
              }`}
            >
              <Wand2 className="h-4 w-4 shrink-0" strokeWidth={2.25} />
              {t.generateWorkspace.tabs.review}
              {workspace.review && workspace.rightTab !== 'review' && <span className="h-2 w-2 animate-pulse rounded-full bg-success-600" title={t.generateWorkspace.tabs.reviewReadyTooltip} />}
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
