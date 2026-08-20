'use client';

import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { GenerateWorkspaceState } from '@/hooks/test-case/use-generate-workspace';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm"
    >
      <div className="surface-card w-full max-w-md animate-[fadeIn_0.2s_ease] p-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 shadow-[var(--shadow-glow-brand)]">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>

        <h2 className="text-h2 mt-5">{workspace.t.generateWorkspace.generatingTitle}</h2>
        <p className="mt-1 text-sm text-ink-500">{workspace.t.generateWorkspace.generatingSubtitle}</p>

        <ul className="mt-6 space-y-3 text-left">
          {steps.map((label, index) => {
            const isDone = index < current;
            const isCurrent = index === current;
            return (
              <li key={label} className="flex items-center gap-3">
                {isDone ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success-600" />
                ) : isCurrent ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-brand-600" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-ink-300" />
                )}
                <span className={`text-sm font-semibold ${isDone ? 'text-ink-400' : isCurrent ? 'text-ink-800' : 'text-ink-400'}`}>
                  {label}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-ink-100">
          <div className="h-full rounded-full bg-brand-600 transition-all duration-500 ease-out" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-xs font-bold text-ink-400">
          {workspace.t.generateWorkspace.generatingStepsDone(current + 1, steps.length)}
        </p>
        <p className="mt-3 text-xs text-ink-400">{workspace.t.generateWorkspace.generatingHint}</p>
      </div>
    </div>
  );
}
