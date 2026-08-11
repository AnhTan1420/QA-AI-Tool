'use client';

import { PlayCircle, ShieldCheck, Loader2, CircleCheck, CircleX, ZoomIn, Download } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

/**
 * "Review Gate" state machine:
 *   [Generate] → status: PENDING_REVIEW → either
 *     "Approve & Run"  (approve as-is, then execute immediately), or
 *     "Edit / Tweak"   (CodeViewer's Edit button → saveEditedScript() self-approves)
 *   → status: APPROVED → "Run" executes directly (fast & deterministic, no AI call).
 *
 * Run never generates or silently approves code on its own — while the script is
 * pending_review, this panel only offers "Approve & Run"; once approved, it's a
 * plain "Run" button.
 */
export function RunResultPanel({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const r = t.automation.run;

  const hasScript = !!automation.script;
  const isApproved = automation.script?.status === 'approved';
  const isPendingReview = hasScript && !isApproved;
  const isBusy = automation.running || automation.approving;
  const canAct = hasScript && !!automation.targetUrl && !isBusy;

  return (
    <div className="surface-card space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="panel-icon">
            <PlayCircle className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div>
            <h3 className="text-h3">Run Test</h3>
            {isPendingReview && <span className="badge-warning mt-1">Pending review</span>}
            {isApproved && <span className="badge-success mt-1">Approved · ready to run</span>}
          </div>
        </div>

        {isPendingReview ? (
          <button type="button" onClick={automation.approveAndRun} disabled={!canAct} className="btn-warning">
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {automation.approving ? 'Approving...' : automation.running ? r.running : 'Approve & Run'}
          </button>
        ) : (
          <button type="button" onClick={automation.runTest} disabled={!canAct} className="btn-success">
            {automation.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {automation.running ? r.running : r.button}
          </button>
        )}
      </div>

      {isPendingReview && (
        <p className="text-caption">Approve it, or edit it above (Edit / Tweak), before it can run.</p>
      )}

      {!automation.script && (
        <p className="rounded-[var(--radius-control)] border border-warning-600/25 bg-warning-50 px-3 py-2 text-xs font-medium text-warning-600">
          Chưa có Playwright code. Vui lòng bấm <strong>Generate Playwright Code</strong> trước khi chạy.
        </p>
      )}

      {automation.approveError && <p className="alert-danger !p-3">{automation.approveError}</p>}
      {automation.runError && <p className="alert-danger !p-3">{automation.runError}</p>}

      {automation.runResult && (
        <div className="space-y-3 border-t border-ink-100 pt-4">
          <div className="flex items-center gap-3">
            <span className={automation.runResult.status === 'passed' ? 'badge-success' : 'badge-danger'}>
              {automation.runResult.status === 'passed' ? (
                <CircleCheck className="h-3.5 w-3.5" />
              ) : (
                <CircleX className="h-3.5 w-3.5" />
              )}
              {r.status[automation.runResult.status]}
            </span>
            <span className="text-caption">{r.durationLabel(automation.runResult.duration_ms)}</span>
          </div>

          {automation.runResult.failure_details && (
            <div className="space-y-1 rounded-[var(--radius-control)] border border-danger-600/20 bg-danger-50 p-3">
              <p className="text-xs font-bold text-danger-600">{r.failureDetailsHeading}</p>
              {automation.runResult.failure_details.selector && (
                <p className="text-xs text-danger-600/90">
                  <span className="font-semibold">{r.selectorLabel}:</span> {automation.runResult.failure_details.selector}
                </p>
              )}
              <p className="text-xs text-danger-600/90">
                <span className="font-semibold">{r.errorLabel}:</span> {automation.runResult.failure_details.error_message}
              </p>
            </div>
          )}

          {automation.runResult.screenshot_url && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-bold text-ink-700">{r.screenshotHeading}</p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => window.open(automation.runResult?.screenshot_url ?? '', '_blank')}
                    title="Zoom"
                    className="icon-btn"
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                  <a
                    href={automation.runResult.screenshot_url}
                    download="screenshot.png"
                    title="Download"
                    className="icon-btn"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              </div>
              <img
                src={automation.runResult.screenshot_url}
                alt="Run screenshot"
                className="max-h-64 cursor-zoom-in rounded-[var(--radius-control)] border border-ink-200 object-contain"
                onClick={() => window.open(automation.runResult?.screenshot_url ?? '', '_blank')}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
