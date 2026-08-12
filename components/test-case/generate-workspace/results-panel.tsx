'use client';

import { useState } from 'react';
import { Brain, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, ArrowRight, Inbox } from 'lucide-react';
import type { TestCaseCategory } from '@/lib/validators/test-case';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';
import { TestCaseCard } from './test-case-card';
import { TraceabilityMatrix } from './traceability-matrix';
import type { GenerateWorkspaceState } from './use-generate-workspace';

const PRIORITY_DOT: Record<string, string> = {
  Critical: 'bg-danger-600',
  Major: 'bg-warning-600',
  Normal: 'bg-ink-400',
};

/** Collapsible "AI Reasoning" card — surfaces the PHASE 0 analysis the Generation Agent
 * already produces on every call (7-layer deep analysis) but the app used to throw away
 * right after validating test_cases. Collapsed by default since it's supplementary to
 * the test cases themselves, not the primary deliverable. */
function AiReasoningPanel({ analysis, t }: { analysis: NonNullable<GenerateWorkspaceState['analysis']>; t: Dictionary }) {
  const [expanded, setExpanded] = useState(false);
  const ar = t.generateWorkspace.aiReasoning;
  const hasContent =
    (analysis.ambiguous_terms?.length ?? 0) > 0 ||
    (analysis.risk_ranking?.length ?? 0) > 0 ||
    (analysis.document_atom_plan?.length ?? 0) > 0 ||
    (analysis.coverage_self_check?.length ?? 0) > 0;

  if (!hasContent) return null;

  return (
    <div className="mt-4 rounded-2xl border border-ink-200 bg-ink-50/60">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-700">
          <Brain className="h-4 w-4 shrink-0 text-brand-600" />
          {ar.title}
          {analysis.input_source && <span className="font-normal normal-case text-ink-400">· {ar.sourceLabel(analysis.input_source)}</span>}
        </span>
        <span className="flex items-center gap-1 text-xs font-semibold text-brand-600">
          {expanded ? ar.collapse : ar.expand}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className="space-y-4 px-4 pb-4 text-sm">
          {(analysis.ambiguous_terms?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">{ar.ambiguousTermsTitle}</p>
              <ul className="space-y-1 text-ink-600">
                {analysis.ambiguous_terms!.map((item, i) => <li key={i}>• {item}</li>)}
              </ul>
            </div>
          )}

          {(analysis.risk_ranking?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">{ar.riskRankingTitle}</p>
              <div className="space-y-1.5">
                {analysis.risk_ranking!.map((risk, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[risk.resulting_priority ?? ''] ?? 'bg-ink-300'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink-800">{risk.scenario}</p>
                      <p className="mt-0.5 text-ink-400">
                        {ar.severityLabel} {risk.severity_1_10 ?? '?'} · {ar.probabilityLabel} {risk.probability_1_10 ?? '?'} · {ar.detectabilityLabel} {risk.detectability_1_10 ?? '?'} → <span className="font-bold text-ink-600">{risk.resulting_priority}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(analysis.document_atom_plan?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">{ar.atomMappingTitle}</p>
              <ul className="space-y-1 text-xs text-ink-600">
                {analysis.document_atom_plan!.map((atom, i) => (
                  <li key={i}>• <span className="font-mono text-brand-600">{atom.atom_id}</span> → <span className="font-mono">{atom.planned_test_case_code}</span></li>
                ))}
              </ul>
            </div>
          )}

          {(analysis.coverage_self_check?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">{ar.coverageSelfCheckTitle}</p>
              <ul className="space-y-1 text-xs text-ink-600">
                {analysis.coverage_self_check!.map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Right column, "results" tab: the generated test cases, grouped by category. */
export function ResultsPanel({ workspace }: { workspace: GenerateWorkspaceState }) {
  const { t } = workspace;
  const [showMatrix, setShowMatrix] = useState(false);
  const coverageOk = (workspace.documentCoverage?.coverage_percent ?? 0) >= 100;

  return (
    <div className="surface-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-eyebrow">{t.generateWorkspace.generatedSetEyebrow}</p>
          <h2 className="text-h2 mt-2">{workspace.safeTestCasesCount} {t.generateWorkspace.testCasesSuffix}</h2>
        </div>
        {workspace.review && (
          <div className="rounded-[var(--radius-control)] bg-ink-50 px-4 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">{t.generateWorkspace.coverageLabel}</p>
            <p className={`text-3xl font-black ${workspace.coverageTone}`}>{workspace.review.coverage_score}%</p>
          </div>
        )}
      </div>

      {workspace.documentCoverage && (
        <div className={`mt-4 rounded-2xl border p-4 text-sm ${coverageOk ? 'border-success-600/20 bg-success-50' : 'border-warning-600/20 bg-warning-50'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`flex items-center gap-1.5 font-bold ${coverageOk ? 'text-success-600' : 'text-warning-600'}`}>
              {coverageOk ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
              {t.generateWorkspace.documentReader.coverageLabel}: {workspace.documentCoverage.coverage_percent}% ({workspace.documentCoverage.covered_atoms}/{workspace.documentCoverage.total_atoms})
            </p>
            {(workspace.documentCoverage.matrix?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setShowMatrix((v) => !v)}
                className="flex items-center gap-1 rounded-lg border border-current/20 bg-white/60 px-2.5 py-1 text-xs font-bold text-inherit transition-colors hover:bg-white"
              >
                {showMatrix ? t.generateWorkspace.traceabilityMatrix.toggleHide : t.generateWorkspace.traceabilityMatrix.toggleShow}
                {showMatrix ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          {!showMatrix && workspace.documentCoverage.uncovered.length > 0 && (
            <ul className="mt-2.5 space-y-1 text-xs text-ink-600">
              {workspace.documentCoverage.uncovered.slice(0, 10).map((item) => (
                <li key={item.atom_id} className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-300" />
                  <span><span className="font-mono text-ink-500">[{item.atom_id}]</span> {item.label} <span className="text-ink-400">({item.source_document})</span></span>
                </li>
              ))}
              {workspace.documentCoverage.uncovered.length > 10 && (
                <li className="pl-2.5 text-ink-400">+{workspace.documentCoverage.uncovered.length - 10} {t.generateWorkspace.documentReader.moreSuffix}</li>
              )}
            </ul>
          )}
          {showMatrix && <TraceabilityMatrix matrix={workspace.documentCoverage.matrix ?? []} t={t} />}
        </div>
      )}

      {workspace.analysis && <AiReasoningPanel analysis={workspace.analysis} t={t} />}

      {workspace.duplicateWarnings.size > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-warning-600/20 bg-warning-50 p-4 text-sm text-warning-600">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">{t.generateWorkspace.duplicateWarning.bannerTitle(workspace.duplicateWarnings.size)}</p>
            <p className="mt-1 text-xs">{t.generateWorkspace.duplicateWarning.bannerDescription}</p>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-5">
        {Object.entries(workspace.groupedCases).map(([category, items]) => (
          <div key={category}>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              {workspace.getCategoryLabel(category as TestCaseCategory)}
              <span className="badge-neutral">{(items ?? []).length}</span>
            </h3>
            <div className="space-y-3">
              {(items ?? []).map((testCase) => (
                <TestCaseCard
                  key={`${testCase?.code}-${testCase?.title}`}
                  testCase={testCase}
                  duplicateWarning={testCase?.code ? workspace.duplicateWarnings.get(testCase.code) : undefined}
                />
              ))}
            </div>
          </div>
        ))}
        {workspace.safeTestCasesCount === 0 && !workspace.isPending && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-ink-200 bg-ink-50/40 p-10 text-center text-ink-500">
            <Inbox className="h-8 w-8 text-ink-300" strokeWidth={1.5} />
            <span className="text-sm">{t.generateWorkspace.emptyState}</span>
          </div>
        )}
        {workspace.safeTestCasesCount > 0 && (
          <button
            type="button"
            onClick={() => workspace.setRightTab('review')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-300 bg-brand-50/60 py-3 text-sm font-bold text-brand-700 transition-all hover:border-brand-400 hover:bg-brand-50"
          >
            {t.generateWorkspace.goToReviewButton}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
