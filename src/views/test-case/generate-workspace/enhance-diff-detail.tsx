'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { GeneratedTestCase } from '@/models/validators/test-case';
import type { FieldChange, StepDiffRow } from '@/services/test-case-diff';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';

type EnhanceDiffLabels = Dictionary['generateWorkspace']['enhanceDiff'];

const STEP_TONE: Record<StepDiffRow['status'], string> = {
  same: 'border-ink-200 bg-white',
  changed: 'border-warning-600/30 bg-warning-50',
  added: 'border-success-600/30 bg-success-50',
  removed: 'border-danger-600/30 bg-danger-50',
};

const STEP_BADGE: Record<StepDiffRow['status'], string> = {
  same: 'bg-ink-100 text-ink-600',
  changed: 'bg-warning-50 text-warning-600',
  added: 'bg-success-50 text-success-600',
  removed: 'bg-danger-50 text-danger-600',
};

/** test_data is stored as JSON text in the diff; show it as readable "key: value" lines. */
function readable(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join('\n');
    }
  } catch {
    // Not JSON: show as is.
  }
  return value;
}

function Version({ label, tone, children }: { label: string; tone: 'old' | 'new'; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-2 ${tone === 'old' ? 'border-danger-600/20 bg-danger-50/50' : 'border-success-600/20 bg-success-50/50'}`}>
      <p className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${tone === 'old' ? 'text-danger-600' : 'text-success-600'}`}>{label}</p>
      <div className="whitespace-pre-wrap break-words text-ink-800">{children}</div>
    </div>
  );
}

function StepCell({ step, ed }: { step?: { step_number: number; action: string; expected_result: string }; ed: EnhanceDiffLabels }) {
  if (!step) return <span className="italic text-ink-400">—</span>;
  return (
    <div className="space-y-0.5">
      <p><span className="font-semibold text-ink-600">{ed.stepLabel(step.step_number)}:</span> {step.action || ed.empty}</p>
      <p className="text-ink-600"><span className="font-semibold">{ed.expectedLabel}:</span> {step.expected_result || ed.empty}</p>
    </div>
  );
}

function StepsComparison({ rows, ed }: { rows: StepDiffRow[]; ed: EnhanceDiffLabels }) {
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-wide md:grid">
        <span className="text-danger-600">{ed.originalLabel}</span>
        <span className="text-success-600">{ed.updatedLabel}</span>
      </div>
      {rows.map((row, i) => (
        <div key={i} className={`rounded-lg border p-2 ${STEP_TONE[row.status]}`}>
          <span className={`mb-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STEP_BADGE[row.status]}`}>
            {ed.stepStatus[row.status]}
          </span>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-danger-600 md:hidden">{ed.originalLabel}</p>
              <StepCell step={row.from} ed={ed} />
            </div>
            <div>
              <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-success-600 md:hidden">{ed.updatedLabel}</p>
              <StepCell step={row.to} ed={ed} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** One changed field. Collapsed: the old → new summary. Expanded: the full original and updated content. */
export function ChangeRow({ change, ed }: { change: FieldChange; ed: EnhanceDiffLabels }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? ed.hideDetail : ed.showDetail}
        className="flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-brand-50"
      >
        <ChevronRight className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-ink-600">{change.label}:</span>{' '}
          {!open && (
            <>
              <span className="line-clamp-2 text-danger-600 line-through">{change.from || ed.empty}</span>{' '}
              <span className="text-ink-400">→</span>{' '}
              <span className="line-clamp-2 text-success-600">{change.to || ed.empty}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="ml-5 mt-1 mb-1 animate-[fadeIn_0.15s_ease]">
          {change.steps ? (
            <StepsComparison rows={change.steps} ed={ed} />
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              <Version label={ed.originalLabel} tone="old">{readable(change.from) || ed.empty}</Version>
              <Version label={ed.updatedLabel} tone="new">{readable(change.to) || ed.empty}</Version>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** The content of a case Enhance created, behind a toggle. */
export function AddedCaseDetail({ testCase, ed }: { testCase: GeneratedTestCase; ed: EnhanceDiffLabels }) {
  const [open, setOpen] = useState(false);
  const steps = testCase.steps ?? [];
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-left font-semibold text-brand-700 transition-colors hover:bg-brand-50"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        {ed.newCaseDetail}
      </button>
      {open && (
        <div className="ml-5 mt-1 space-y-1.5 animate-[fadeIn_0.15s_ease]">
          {(testCase.preconditions ?? []).length > 0 && (
            <p className="text-ink-700"><span className="font-semibold text-ink-600">{ed.fields.preconditions}:</span> {(testCase.preconditions ?? []).join('; ')}</p>
          )}
          {Object.keys(testCase.test_data ?? {}).length > 0 && (
            <p className="whitespace-pre-wrap text-ink-700"><span className="font-semibold text-ink-600">{ed.fields.testData}:</span> {readable(JSON.stringify(testCase.test_data))}</p>
          )}
          <StepsComparison rows={steps.map((s, i) => ({ status: 'added' as const, to: { step_number: s.step_number ?? i + 1, action: s.action ?? '', expected_result: s.expected_result ?? '' } }))} ed={ed} />
          <p className="text-ink-700"><span className="font-semibold text-ink-600">{ed.fields.finalExpectedResult}:</span> {testCase.final_expected_result || ed.empty}</p>
        </div>
      )}
    </div>
  );
}
