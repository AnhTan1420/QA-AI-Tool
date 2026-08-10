'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

export function RunResultPanel({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const r = t.automation.run;

  const canRun = !!automation.script && !!automation.targetUrl;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">Run Test</h3>
        <button
          type="button"
          onClick={automation.runTest}
          disabled={!canRun || automation.running}
          className="rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {automation.running ? r.running : r.button}
        </button>
      </div>

      {!automation.script && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
          ⚠️ Chưa có Playwright code. Vui lòng bấm <strong>Generate Playwright Code</strong> trước khi chạy.
        </p>
      )}

      {automation.runError && (
        <p className="text-xs font-semibold text-red-600">{automation.runError}</p>
      )}

      {automation.runResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                automation.runResult.status === 'passed'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {r.status[automation.runResult.status]}
            </span>
            <span className="text-xs text-gray-500">{r.durationLabel(automation.runResult.duration_ms)}</span>
          </div>

          {automation.runResult.failure_details && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
              <p className="text-xs font-bold text-red-800">{r.failureDetailsHeading}</p>
              {automation.runResult.failure_details.selector && (
                <p className="text-xs text-red-700">
                  <span className="font-semibold">{r.selectorLabel}:</span> {automation.runResult.failure_details.selector}
                </p>
              )}
              <p className="text-xs text-red-700">
                <span className="font-semibold">{r.errorLabel}:</span> {automation.runResult.failure_details.error_message}
              </p>
            </div>
          )}

          {automation.runResult.screenshot_url && (
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">{r.screenshotHeading}</p>
              <img
                src={automation.runResult.screenshot_url}
                alt="Run screenshot"
                className="rounded-lg border border-gray-200 max-h-64 object-contain cursor-zoom-in"
                onClick={() => window.open(automation.runResult?.screenshot_url ?? '', '_blank')}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}