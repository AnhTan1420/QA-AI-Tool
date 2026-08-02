'use client';

import type { GenerateWorkspaceState } from './use-generate-workspace';

/**
 * Full-screen centered modal shown while a generate request is in flight
 * (workspace.isPending). Dims + blurs the page behind it and walks through the
 * same progress steps as the pulse indicator on the results tab, so the user
 * gets clear, reassuring feedback instead of a frozen-looking screen during
 * the up-to-~60s AI call (see app/api/ai/generate/route.ts maxDuration).
 */
export function GeneratingModal({ workspace }: { workspace: GenerateWorkspaceState }) {
  if (!workspace.isPending) return null;

  const steps = workspace.t.generateWorkspace.generatingSteps;
  const current = Math.min(workspace.generatingStep, steps.length - 1);
  const percent = Math.round(((current + 1) / steps.length) * 100);

  return (
    <div
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md animate-[fadeIn_0.2s_ease] rounded-3xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-200">
          <svg className="h-8 w-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>

        <h2 className="mt-5 text-xl font-black tracking-tight text-slate-950">{workspace.t.generateWorkspace.generatingTitle}</h2>
        <p className="mt-1 text-sm text-slate-500">{workspace.t.generateWorkspace.generatingSubtitle}</p>

        <ul className="mt-6 space-y-3 text-left">
          {steps.map((label, index) => {
            const isDone = index < current;
            const isCurrent = index === current;
            return (
              <li key={label} className="flex items-center gap-3">
                {isDone ? (
                  <svg className="h-5 w-5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : isCurrent ? (
                  <svg className="h-5 w-5 shrink-0 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 shrink-0 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
                <span className={`text-sm font-semibold ${isDone ? 'text-slate-400' : isCurrent ? 'text-slate-800' : 'text-slate-400'}`}>
                  {label}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-xs font-bold text-slate-400">
          {workspace.t.generateWorkspace.generatingStepsDone(current + 1, steps.length)}
        </p>
        <p className="mt-3 text-xs text-slate-400">{workspace.t.generateWorkspace.generatingHint}</p>
      </div>
    </div>
  );
}
