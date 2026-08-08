'use client';

import { CheckCircle2, XCircle, AlertTriangle, Clock, Loader2, Play, Pause } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { BatchAutomationState, BatchItemStatus } from './use-batch-automation';

const ITEM_STATUS_ICON: Record<BatchItemStatus, React.ReactNode> = {
  queued: <Clock className="h-4 w-4 text-ink-400" />,
  running: <Loader2 className="h-4 w-4 animate-spin text-brand-600" />,
  passed: <CheckCircle2 className="h-4 w-4 text-success-600" />,
  failed: <XCircle className="h-4 w-4 text-danger-600" />,
  error: <AlertTriangle className="h-4 w-4 text-warning-600" />,
  skipped: <Clock className="h-4 w-4 text-ink-300" />,
};

export function BatchProgressPanel({
  automation,
  onResume,
  onClose,
}: {
  automation: BatchAutomationState;
  onResume: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const p = t.batchAutomation.progress;
  const { batch, items, isProcessing, error } = automation;

  if (!batch) return null;

  const done = batch.status === 'completed';
  const settledCount = batch.passed_count + batch.failed_count + batch.error_count;
  const progressPct = batch.total_count > 0 ? Math.round((settledCount / batch.total_count) * 100) : 0;
  const isPaused = !isProcessing && !done && (batch.queued_count > 0 || batch.running_count > 0);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between text-sm font-semibold text-ink-700">
          <span>
            {done ? p.statusCompleted : isProcessing ? p.statusRunning : p.statusPaused} ({settledCount}
            {p.totalLabel(batch.total_count)})
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="badge-neutral">{p.queuedLabel}: {batch.queued_count}</span>
        <span className="badge-success">{p.passedLabel}: {batch.passed_count}</span>
        <span className="badge-danger">{p.failedLabel}: {batch.failed_count}</span>
        <span className="badge-warning">{p.errorLabel}: {batch.error_count}</span>
      </div>

      {error && <div className="alert-danger">{error}</div>}
      {done && <div className="alert-info">{p.doneNotice}</div>}
      {isPaused && <div className="alert-info">{p.pausedNotice}</div>}
      {isProcessing && <p className="text-caption italic">{p.keepTabOpenNotice}</p>}

      <div className="max-h-72 overflow-y-auto rounded-[var(--radius-control)] border border-ink-200">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 border-b border-ink-100 px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-800">
                {item.test_cases?.code ?? item.test_case_id} — {item.test_cases?.title ?? ''}
              </p>
              {item.generate_error && <p className="truncate text-xs text-danger-600">{item.generate_error}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-600">
              {ITEM_STATUS_ICON[item.status]}
              {p.itemStatus[item.status]}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-ink-100 pt-4">
        {!done && (
          <button onClick={onResume} disabled={isProcessing} className="btn-primary">
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {p.resuming}
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> {p.resumeButton}
              </>
            )}
          </button>
        )}
        {isProcessing && (
          <button onClick={automation.stop} className="btn-secondary">
            <Pause className="h-4 w-4" />
          </button>
        )}
        <button onClick={onClose} className="btn-ghost">
          {p.closeButton}
        </button>
      </div>
    </div>
  );
}
