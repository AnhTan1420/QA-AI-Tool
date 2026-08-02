'use client';

import { useState } from 'react';
import type { TestCaseCategory } from '@/lib/validators/test-case';
import { TestCaseCard } from './test-case-card';
import type { GenerateWorkspaceState } from './use-generate-workspace';

const PRIORITY_DOT: Record<string, string> = {
  Critical: 'bg-red-500',
  Major: 'bg-amber-500',
  Normal: 'bg-slate-400',
};

/** Collapsible "AI Reasoning" card — surfaces the PHASE 0 analysis the Generation Agent
 * already produces on every call (7-layer deep analysis) but the app used to throw away
 * right after validating test_cases. Collapsed by default since it's supplementary to
 * the test cases themselves, not the primary deliverable. */
function AiReasoningPanel({ analysis }: { analysis: NonNullable<GenerateWorkspaceState['analysis']> }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent =
    (analysis.ambiguous_terms?.length ?? 0) > 0 ||
    (analysis.risk_ranking?.length ?? 0) > 0 ||
    (analysis.document_atom_plan?.length ?? 0) > 0 ||
    (analysis.coverage_self_check?.length ?? 0) > 0;

  if (!hasContent) return null;

  return (
    <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-xs font-black uppercase tracking-wide text-indigo-700">
          🧠 AI Reasoning {analysis.input_source && <span className="ml-1 font-normal normal-case text-indigo-400">· nguồn: {analysis.input_source}</span>}
        </span>
        <span className="text-xs font-bold text-indigo-500">{expanded ? 'Thu gọn ▲' : 'Xem chi tiết ▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-4 px-4 pb-4 text-sm">
          {(analysis.ambiguous_terms?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-black uppercase tracking-wide text-indigo-600">Điểm mơ hồ AI phát hiện trong requirement</p>
              <ul className="space-y-1 text-slate-600">
                {analysis.ambiguous_terms!.map((item, i) => <li key={i}>• {item}</li>)}
              </ul>
            </div>
          )}

          {(analysis.risk_ranking?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-black uppercase tracking-wide text-indigo-600">Xếp hạng rủi ro (FMEA)</p>
              <div className="space-y-1.5">
                {analysis.risk_ranking!.map((risk, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-xs">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[risk.resulting_priority ?? ''] ?? 'bg-slate-300'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800">{risk.scenario}</p>
                      <p className="mt-0.5 text-slate-400">
                        Severity {risk.severity_1_10 ?? '?'} · Probability {risk.probability_1_10 ?? '?'} · Detectability {risk.detectability_1_10 ?? '?'} → <span className="font-bold text-slate-600">{risk.resulting_priority}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(analysis.document_atom_plan?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-black uppercase tracking-wide text-indigo-600">Mapping tài liệu → test case</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {analysis.document_atom_plan!.map((atom, i) => (
                  <li key={i}>• <span className="font-mono text-indigo-600">{atom.atom_id}</span> → <span className="font-mono">{atom.planned_test_case_code}</span></li>
                ))}
              </ul>
            </div>
          )}

          {(analysis.coverage_self_check?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-xs font-black uppercase tracking-wide text-indigo-600">AI tự kiểm tra độ phủ</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {analysis.coverage_self_check!.map((item, i) => <li key={i}>✓ {item}</li>)}
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

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_2px_20px_-4px_rgba(15,23,42,0.06)] backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-blue-600">{t.generateWorkspace.generatedSetEyebrow}</p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{workspace.safeTestCasesCount} {t.generateWorkspace.testCasesSuffix}</h2>
        </div>
        {workspace.review && (
          <div className="rounded-2xl bg-slate-50 px-4 py-2 text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t.generateWorkspace.coverageLabel}</p>
            <p className={`text-3xl font-black ${workspace.coverageTone}`}>{workspace.review.coverage_score}%</p>
          </div>
        )}
      </div>

      {workspace.documentCoverage && (
        <div className={`mt-4 rounded-2xl border p-4 text-sm ${workspace.documentCoverage.coverage_percent >= 100 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <p className={`font-black ${workspace.documentCoverage.coverage_percent >= 100 ? 'text-emerald-700' : 'text-amber-700'}`}>
            {t.generateWorkspace.documentReader.coverageLabel}: {workspace.documentCoverage.coverage_percent}% ({workspace.documentCoverage.covered_atoms}/{workspace.documentCoverage.total_atoms})
          </p>
          {workspace.documentCoverage.uncovered.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
              {workspace.documentCoverage.uncovered.slice(0, 10).map((item) => (
                <li key={item.atom_id}>• [{item.atom_id}] {item.label} ({item.source_document})</li>
              ))}
              {workspace.documentCoverage.uncovered.length > 10 && <li>… +{workspace.documentCoverage.uncovered.length - 10} {t.generateWorkspace.documentReader.moreSuffix}</li>}
            </ul>
          )}
        </div>
      )}

      {workspace.analysis && <AiReasoningPanel analysis={workspace.analysis} />}

      <div className="mt-6 space-y-5">
        {Object.entries(workspace.groupedCases).map(([category, items]) => (
          <div key={category}>
            <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">{workspace.getCategoryLabel(category as TestCaseCategory)}</h3>
            <div className="space-y-3">
              {(items ?? []).map((testCase) => <TestCaseCard key={`${testCase?.code}-${testCase?.title}`} testCase={testCase} />)}
            </div>
          </div>
        ))}
        {workspace.safeTestCasesCount === 0 && !workspace.isPending && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 p-10 text-center text-slate-500">
            <svg className="h-8 w-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm">{t.generateWorkspace.emptyState}</span>
          </div>
        )}
        {workspace.safeTestCasesCount > 0 && (
          <button
            type="button"
            onClick={() => workspace.setRightTab('review')}
            className="w-full rounded-2xl border border-dashed border-purple-200 bg-purple-50/50 py-3 text-sm font-bold text-purple-700 transition-all hover:border-purple-300 hover:bg-purple-50 hover:shadow-sm"
          >
            Bộ test case đã sẵn sàng → Chuyển sang Review & Enhance
          </button>
        )}
      </div>
    </div>
  );
}
