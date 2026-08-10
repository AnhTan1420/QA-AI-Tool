'use client';

import { useEffect, useState } from 'react';
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
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-700">{h.runsHeading}</h3>
      <ol className="space-y-3">
        {runs.map((run) => (
          <li key={run.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-xs space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={`rounded-full px-2 py-0.5 font-bold ${
                  run.status === 'passed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
              >
                {t.automation.run.status[run.status]}
              </span>
              <span className="text-gray-500">{t.automation.run.durationLabel(run.duration_ms)}</span>
              <span className="ml-auto text-gray-400">{new Date(run.started_at).toLocaleString()}</span>
            </div>

            {run.screenshot_url && (
              <div className="flex items-start gap-2">
                <img
                  src={run.screenshot_url}
                  alt={`Run ${run.id}`}
                  className="h-20 w-auto rounded border border-gray-200 object-contain cursor-zoom-in hover:opacity-80 transition"
                  onClick={() => setZoomImage(run.screenshot_url)}
                />
                <a
                  href={run.screenshot_url}
                  download={`run-${run.id}-screenshot.png`}
                  className="rounded border border-gray-300 px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-100"
                  onClick={(e) => e.stopPropagation()}
                >
                  ↓ Download
                </a>
              </div>
            )}

            {run.failure_details && (
              <div className="rounded bg-red-50 border border-red-100 p-2 text-red-700">
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-full max-h-full">
            <img
              src={zoomImage}
              alt="Zoomed screenshot"
              className="max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain"
            />
            <a
              href={zoomImage}
              download="screenshot.png"
              className="absolute top-2 right-2 rounded bg-white/90 px-3 py-1.5 text-xs font-bold text-gray-800 shadow hover:bg-white"
              onClick={(e) => e.stopPropagation()}
            >
              ↓ Download
            </a>
            <button
              onClick={() => setZoomImage(null)}
              className="absolute top-2 left-2 rounded bg-white/90 px-3 py-1.5 text-xs font-bold text-gray-800 shadow hover:bg-white"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
