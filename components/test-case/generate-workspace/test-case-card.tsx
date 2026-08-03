'use client';

import { getPriorityStyle } from '@/lib/test-case-taxonomy';
import type { GeneratedTestCase } from '@/lib/validators/test-case';
import type { DuplicateWarning } from '@/lib/test-case-similarity';
import { useLanguage } from '@/lib/i18n/language-context';

export function TestCaseCard({ testCase, duplicateWarning }: { testCase: GeneratedTestCase; duplicateWarning?: DuplicateWarning }) {
  const { t } = useLanguage();
  if (!testCase) return null;
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">{testCase.code}</span>
        <span className={`rounded-lg px-2 py-1 text-xs font-bold ${getPriorityStyle(testCase.priority)}`}>{testCase.priority}</span>
        {duplicateWarning && duplicateWarning.similarTo.length > 0 && (
          <span
            className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"
            title={duplicateWarning.similarTo.map((s) => `${s.code} (${s.score}%): ${s.title}`).join('\n')}
          >
            ⚠ Có thể trùng {duplicateWarning.similarTo.map((s) => `${s.code} (${s.score}%)`).join(', ')}
          </span>
        )}
      </div>
      <h4 className="mt-3 font-bold text-slate-950">{testCase.title}</h4>
      {(testCase.preconditions ?? []).length > 0 && <p className="mt-2 text-sm text-slate-600">{t.generateWorkspace.preconditionsPrefix}: {testCase.preconditions.join('; ')}</p>}
      <ol className="mt-3 space-y-2 text-sm text-slate-700">
        {(testCase.steps ?? []).map((step) => (
          <li key={step?.step_number} className="rounded-xl bg-slate-50 p-3">
            <span className="font-bold">{step?.step_number}. {step?.action}</span>
            <span className="mt-1 block text-blue-700">{t.generateWorkspace.expectedPrefix}: {step?.expected_result}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm font-semibold text-emerald-700">{t.generateWorkspace.finalPrefix}: {testCase.final_expected_result}</p>
    </article>
  );
}
