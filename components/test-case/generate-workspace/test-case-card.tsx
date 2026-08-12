'use client';

import { AlertTriangle, CheckCircle2, CornerDownRight } from 'lucide-react';
import { getPriorityStyle } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase } from '@/lib/validators/test-case';
import type { DuplicateWarning } from '@/lib/test-case-similarity';
import { useLanguage } from '@/lib/i18n/language-context';

export function TestCaseCard({ testCase, duplicateWarning }: { testCase: GeneratedTestCase; duplicateWarning?: DuplicateWarning }) {
  const { t } = useLanguage();
  if (!testCase) return null;
  return (
    <article className="rounded-2xl border border-ink-200 p-4 transition-shadow hover:shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge-brand font-mono">{testCase.code}</span>
        <span className={`rounded-lg px-2 py-1 text-xs font-bold ${getPriorityStyle(testCase.priority)}`}>{testCase.priority}</span>
        {duplicateWarning && duplicateWarning.similarTo.length > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-lg bg-warning-50 px-2 py-1 text-xs font-bold text-warning-600"
            title={duplicateWarning.similarTo.map((s) => `${s.code} (${s.score}%): ${s.title}`).join('\n')}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {t.generateWorkspace.duplicateWarning.badge(duplicateWarning.similarTo.map((s) => `${s.code} (${s.score}%)`).join(', '))}
          </span>
        )}
      </div>
      <h4 className="text-h3 mt-3">{testCase.title}</h4>
      {(testCase.preconditions ?? []).length > 0 && (
        <p className="mt-2 text-sm text-ink-600">
          <span className="font-semibold text-ink-700">{t.generateWorkspace.preconditionsPrefix}:</span> {testCase.preconditions.join('; ')}
        </p>
      )}
      <ol className="mt-3 space-y-2 text-sm text-ink-700">
        {(testCase.steps ?? []).map((step) => (
          <li key={step?.step_number} className="rounded-[var(--radius-control)] bg-ink-50 p-3">
            <div className="flex gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[10px] font-bold text-ink-600">{step?.step_number}</span>
              <span className="font-semibold text-ink-800">{step?.action}</span>
            </div>
            <span className="mt-1.5 flex items-start gap-1.5 pl-7 text-brand-700">
              <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><span className="font-semibold">{t.generateWorkspace.expectedPrefix}:</span> {step?.expected_result}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 flex items-start gap-1.5 rounded-[var(--radius-control)] border border-success-600/20 bg-success-50 px-3 py-2 text-sm font-semibold text-success-600">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t.generateWorkspace.finalPrefix}: {testCase.final_expected_result}</span>
      </p>
    </article>
  );
}
