'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationRun } from './types';
import { ScreenshotLightbox } from './screenshot-lightbox';

const STEPS = ['launching', 'scanning', 'executing', 'capturing'] as const;

export function RunResultViewer({
  running,
  run,
}: {
  running: boolean;
  run: AutomationRun | null;
}) {
  const { t } = useLanguage();
  const [lightbox, setLightbox] = useState(false);

  if (running && !run) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-6 space-y-4">
        <p className="font-medium text-blue-800">{t.automation.runningTest}</p>
        <div className="flex gap-4">
          {STEPS.map((s, i) => (
            <div key={s} className="text-xs text-blue-600 capitalize">
              {i + 1}. {s}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!run) return null;

  const passed = run.status === 'passed';

  return (
    <div className={`rounded-xl border p-6 space-y-4 ${passed ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <div className="flex items-center justify-between">
        <p className={`font-semibold ${passed ? 'text-green-800' : 'text-red-800'}`}>
          {passed ? t.automation.testPassed : t.automation.testFailed}
          {run.duration_ms != null && ` · ${(run.duration_ms / 1000).toFixed(1)}s`}
        </p>
        {run.healing_log?.retried && (
          <span className="px-2 py-1 rounded bg-amber-100 text-amber-800 text-xs font-medium">
            {t.automation.selfHealed}
          </span>
        )}
      </div>

      {run.screenshot_path && (
        <button type="button" onClick={() => setLightbox(true)} className="block">
          <img
            src={`/api/automation/runs/${run.id}/screenshot`}
            alt="Run screenshot"
            className="max-h-40 rounded-lg border shadow-sm"
          />
        </button>
      )}

      {!passed && run.bug_analysis && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="text-sm space-y-2">
            <p className="font-medium">{t.automation.bugAnalysis}</p>
            <p><span className="text-gray-500">{t.automation.failedElement}:</span> {run.bug_analysis.failed_element.selector}</p>
            <p><span className="text-gray-500">{t.automation.expected}:</span> {run.bug_analysis.expected_vs_actual.expected}</p>
            <p><span className="text-gray-500">{t.automation.actual}:</span> {run.bug_analysis.expected_vs_actual.actual}</p>
            <p><span className="text-gray-500">{t.automation.suggestedFix}:</span> {run.bug_analysis.suggested_fix}</p>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs capitalize ${run.bug_analysis.severity === 'critical' ? 'bg-red-200' : 'bg-yellow-100'}`}>
              {t.automation.severity}: {run.bug_analysis.severity}
            </span>
          </div>
        </div>
      )}

      {run.healing_log && (
        <div className="text-xs font-mono bg-white/60 rounded p-3">
          <span className="text-red-600 line-through">{run.healing_log.original_selector}</span>
          {' → '}
          <span className="text-green-700">{run.healing_log.healed_selector}</span>
        </div>
      )}

      {run.execution_log && (
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-600">{t.automation.executionLog}</summary>
          <pre className="mt-2 bg-white/60 rounded p-3 overflow-x-auto max-h-48">{run.execution_log}</pre>
        </details>
      )}

      {lightbox && run.screenshot_path && (
        <ScreenshotLightbox
          runId={run.id}
          onClose={() => setLightbox(false)}
          hasAnnotated={Boolean(run.annotated_screenshot_path)}
        />
      )}
    </div>
  );
}