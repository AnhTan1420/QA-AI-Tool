'use client';

import { useEffect, useState } from 'react';
import { History, CircleCheck, CircleX, AlertTriangle, ZoomIn, Download, X, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';

type RunEntry = {
  id: string;
  status: 'passed' | 'failed' | 'error' | 'flaky';
  duration_ms: number;
  attempts: number;
  execution_mode: 'serverless' | 'self_hosted';
  screenshot_url: string | null; // raw storage path; resolved lazily via /screenshot route
  video_url: string | null; // raw storage path; resolved lazily via /video route
  html_report_url: string | null; // raw storage path; resolved lazily via /html-report route
  trace_playwright_dev_url: string | null; // already a ready-to-open trace.playwright.dev link (see the runs route)
  failure_details: { error_message: string; selector?: string } | null;
  started_at: string;
  profiles: { full_name: string | null } | null;
};

const videoSrc = (runId: string) => `/api/automation/runs/${runId}/video`;
const htmlReportSrc = (runId: string) => `/api/automation/runs/${runId}/html-report`;
const screenshotSrc = (runId: string) => `/api/automation/runs/${runId}/screenshot`;

export function AutomationHistory({ testCaseId, refreshKey = 0 }: { testCaseId: string; refreshKey?: number }) {
  const { t } = useLanguage();
  const h = t.automation.history;

  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);

  async function fetchPage(before?: string | null) {
    const url = before
      ? `/api/test-cases/${testCaseId}/automation/runs?before=${encodeURIComponent(before)}`
      : `/api/test-cases/${testCaseId}/automation/runs`;
    return fetch(url)
      .then((r) => r.json())
      .catch(() => ({ success: false, data: [], nextCursor: null }));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setInitialLoading(true);
      const res = await fetchPage(null);
      if (cancelled) return;
      if (res.success) {
        setRuns(res.data ?? []);
        setNextCursor(res.nextCursor ?? null);
      }
      setInitialLoading(false);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testCaseId, refreshKey]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const res = await fetchPage(nextCursor);
    if (res.success) {
      setRuns((prev) => [...prev, ...(res.data ?? [])]);
      setNextCursor(res.nextCursor ?? null);
    }
    setLoadingMore(false);
  }

  if (initialLoading) {
    return (
      <div className="surface-card p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="panel-icon">
            <History className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <h3 className="text-h3">{h.runsHeading}</h3>
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-[var(--radius-control)] bg-ink-100" />
          ))}
        </div>
      </div>
    );
  }

  if (runs.length === 0) return null;

  return (
    <div className="surface-card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="panel-icon">
          <History className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <h3 className="text-h3">{h.runsHeading}</h3>
        <span className="badge-neutral">{runs.length}{nextCursor ? '+' : ''}</span>
      </div>

      <ol className="space-y-3">
        {runs.map((run) => (
          <li key={run.id} className="space-y-2 rounded-[var(--radius-control)] border border-ink-100 bg-ink-50/60 p-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={
                  run.status === 'passed' ? 'badge-success' : run.status === 'flaky' ? 'badge-warning' : 'badge-danger'
                }
              >
                {run.status === 'passed' && <CircleCheck className="h-3.5 w-3.5" />}
                {run.status === 'flaky' && <AlertTriangle className="h-3.5 w-3.5" />}
                {(run.status === 'failed' || run.status === 'error') && <CircleX className="h-3.5 w-3.5" />}
                {t.automation.run.status[run.status]}
              </span>
              <span className="text-caption">{t.automation.run.durationLabel(run.duration_ms)}</span>
              {run.attempts > 1 && <span className="text-caption">{t.automation.run.attemptsLabel(run.attempts)}</span>}
              {run.execution_mode === 'self_hosted' && (
                <span className="badge-brand">{t.automation.run.executionModeBadgeFullRun}</span>
              )}
              <span className="ml-auto text-caption">{new Date(run.started_at).toLocaleString()}</span>
            </div>

            {(run.trace_playwright_dev_url || run.video_url || run.html_report_url) && (
              <div className="flex flex-wrap gap-2">
                {run.trace_playwright_dev_url && (
                  <a href={run.trace_playwright_dev_url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                    <ExternalLink className="h-3.5 w-3.5" /> {t.automation.run.openTrace}
                  </a>
                )}
                {run.video_url && (
                  <a href={videoSrc(run.id)} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                    <ExternalLink className="h-3.5 w-3.5" /> {t.automation.run.openVideo}
                  </a>
                )}
                {run.html_report_url && (
                  <a href={htmlReportSrc(run.id)} download="playwright-report.zip" className="btn-secondary btn-sm">
                    <Download className="h-3.5 w-3.5" /> {t.automation.run.downloadHtmlReport}
                  </a>
                )}
              </div>
            )}

            {run.screenshot_url && (
              <div className="flex items-start gap-2">
                <img
                  src={screenshotSrc(run.id)}
                  alt={`Run ${run.id}`}
                  loading="lazy"
                  decoding="async"
                  className="h-20 w-auto cursor-zoom-in rounded-[var(--radius-control)] border border-ink-200 object-contain transition hover:opacity-80"
                  onClick={() => setZoomImage(screenshotSrc(run.id))}
                />
                <button type="button" onClick={() => setZoomImage(screenshotSrc(run.id))} title="Zoom" className="icon-btn h-8 w-8">
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <a
                  href={screenshotSrc(run.id)}
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

      {nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="btn-secondary btn-sm mt-4 w-full disabled:opacity-60"
        >
          {loadingMore ? '...' : h.loadMore ?? 'Load more'}
        </button>
      )}

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
