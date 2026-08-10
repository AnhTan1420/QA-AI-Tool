'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

/**
 * Fullscreen screenshot zoom modal.
 */
function ScreenshotModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Automation run screenshot (zoomed)"
          className="w-full rounded-lg shadow-2xl"
        />
        <div className="mt-3 flex justify-center gap-3">
          <a
            href={url}
            download="screenshot.png"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow hover:bg-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            ↓ Download
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-900"
          >
            ✕ Close
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Run result panel.
 * The "Run Automation Test" button now calls generateAndRun() which:
 *   - auto-generates code if none exists, then runs it
 *   - or runs existing code directly
 *
 * Screenshot viewer supports:
 *   - Click to zoom (fullscreen modal)
 *   - Direct download link
 */
export function RunResultPanel({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const r = t.automation.run;
  const [zoomedUrl, setZoomedUrl] = useState<string | null>(null);

  const isRunDisabled = automation.running || automation.generating || !automation.targetUrl;
  const buttonLabel = automation.generating
    ? 'Generating code...'
    : automation.running
    ? r.running
    : automation.script
    ? r.button          // script exists: just run
    : 'Generate & Run'; // no script: auto-generate then run

  return (
    <>
      {zoomedUrl && <ScreenshotModal url={zoomedUrl} onClose={() => setZoomedUrl(null)} />}

      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">{r.resultHeading}</h3>
            {!automation.script && (
              <p className="mt-1 text-xs text-gray-400">
                No script yet — clicking the button will auto-generate code then run it.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={automation.generateAndRun}
            disabled={isRunDisabled}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50 ${
              automation.script
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            {buttonLabel}
          </button>
        </div>

        {automation.generateError && (
          <p className="mb-3 text-xs font-semibold text-red-600">
            Code generation failed: {automation.generateError}
          </p>
        )}
        {automation.runError && (
          <p className="mb-3 text-xs font-semibold text-red-600">{automation.runError}</p>
        )}

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
                  <span className="font-semibold">{r.errorLabel}:</span>{' '}
                  {automation.runResult.failure_details.error_message}
                </p>
              </div>
            )}

            {automation.runResult.screenshot_url && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-bold text-gray-600">{r.screenshotHeading}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setZoomedUrl(automation.runResult!.screenshot_url)}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      🔍 Zoom
                    </button>
                    <a
                      href={automation.runResult.screenshot_url}
                      download="screenshot.png"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      ↓ Download
                    </a>
                  </div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={automation.runResult.screenshot_url}
                  alt="Automation run screenshot"
                  className="max-h-72 w-full cursor-zoom-in rounded-lg border border-gray-200 object-contain hover:opacity-90 transition"
                  onClick={() => setZoomedUrl(automation.runResult!.screenshot_url)}
                />
                <p className="mt-1 text-[11px] text-gray-400">Click image to zoom • Hover actions above for download</p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
