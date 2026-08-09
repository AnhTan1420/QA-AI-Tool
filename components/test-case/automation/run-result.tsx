'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

export function RunResultPanel({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const r = t.automation.run;

  if (!automation.script) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">{r.resultHeading}</h3>
        <button
          type="button"
          onClick={automation.runTest}
          disabled={automation.running}
          className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {automation.running ? r.running : r.button}
        </button>
      </div>

      {automation.runError && <p className="mb-3 text-xs font-semibold text-red-600">{automation.runError}</p>}

      {automation.runResult && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
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
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-1 text-xs font-bold text-red-800">{r.failureDetailsHeading}</p>
              {automation.runResult.failure_details.selector && (
                <p className="text-xs text-red-700">
                  <span className="font-semibold">{r.selectorLabel}:</span>{' '}
                  <code className="rounded bg-red-100 px-1">{automation.runResult.failure_details.selector}</code>
                </p>
              )}
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-red-700">
                <span className="font-semibold">{r.errorLabel}:</span> {automation.runResult.failure_details.error_message}
              </p>
            </div>
          )}

          {automation.runResult.screenshot_url && (
            <div>
              <p className="mb-1 text-xs font-bold text-gray-600">{r.screenshotHeading}</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase Storage URL, next/image domain config not worth it for a private, expiring URL */}
              <img
                src={automation.runResult.screenshot_url}
                alt="Automation run screenshot"
                className="max-h-96 w-full rounded-lg border border-gray-200 object-contain"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
