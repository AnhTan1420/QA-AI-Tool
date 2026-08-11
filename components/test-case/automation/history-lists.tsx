'use client';

import { useEffect, useState } from 'react';
import { History, CircleCheck, CircleX, ZoomIn, Download, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';

type RunEntry = {
  id: string;
  status: 'passed' | 'failed' | 'error';
  duration_ms: number;
  screenshot_url: string | null;
  failure_details: { error_message: string; selector?: string } | null;
  started_at: string;
  profiles: { full_name: string | null } | null;
};

export function AutomationHistory({ testCaseId, refreshKey = 0 }: { testCaseId: string; refreshKey?: number }) {
  const { t } = useLanguage();
  const h = t.automation.history;

  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const runsRes = await fetch(`/api/test-cases/${testCaseId}/automation/runs`)
        .then((r) => r.json())
        .catch(() => ({ success: false, data: [] }));
      if (cancelled) return;
      if (runsRes.success) setRuns(runsRes.data ?? []);
      setInitialLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [testCaseId, refreshKey]);

  if (initialLoading) return null;
  if (runs.length === 0) return null;

  return (
    <div className="surface-card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="panel-icon">
          <History className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <h3 className="text-h3">{h.runsHeading}</h3>
        <span className="badge-neutral">{runs.length}</span>
      </div>

      <ol className="space-y-3">
        {runs.map((run) => (
          <li key={run.id} className="space-y-2 rounded-[var(--radius-control)] border border-ink-100 bg-ink-50/60 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className={run.status === 'passed' ? 'badge-success' : 'badge-danger'}>
                {run.status === 'passed' ? <CircleCheck className="h-3.5 w-3.5" /> : <CircleX className="h-3.5 w-3.5" />}
                {t.automation.run.status[run.status]}
              </span>
              <span className="text-caption">{t.automation.run.durationLabel(run.duration_ms)}</span>
              <span className="ml-auto text-caption">{new Date(run.started_at).toLocaleString()}</span>
            </div>

            {run.screenshot_url && (
              <div className="flex items-start gap-2">
                <img
                  src={run.screenshot_url}
                  alt={`Run ${run.id}`}
                  className="h-20 w-auto cursor-zoom-in rounded-[var(--radius-control)] border border-ink-200 object-contain transition hover:opacity-80"
                  onClick={() => setZoomImage(run.screenshot_url)}
                />
                <button type="button" onClick={() => setZoomImage(run.screenshot_url)} title="Zoom" className="icon-btn h-8 w-8">
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <a
                  href={run.screenshot_url}
                  download={`run-${run.id}-screenshot.png`}
                  title="Download"
                  className="icon-btn h-8 w-8"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            {run.failure_details && (
              <div className="rounded-[var(--radius-control)] border border-danger-600/20 bg-danger-50 p-2 text-danger-600">
                <p className="font-semibold">{run.failure_details.error_message}</p>
                {run.failure_details.selector && (
                  <p className="mt-0.5 text-[10px] opacity-80">Selector: {run.failure_details.selector}</p>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      {/* Zoom Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/80 p-4 backdrop-blur-sm"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-h-full max-w-full">
            <img
              src={zoomImage}
              alt="Zoomed screenshot"
              className="max-h-[90vh] max-w-full rounded-[var(--radius-card)] object-contain shadow-[var(--shadow-soft-lg)]"
            />
            <a
              href={zoomImage}
              download="screenshot.png"
              className="btn-secondary btn-sm absolute right-3 top-3"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="h-3.5 w-3.5" />
              Download
            </a>
            <button onClick={() => setZoomImage(null)} className="btn-secondary btn-sm absolute left-3 top-3">
              <X className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
