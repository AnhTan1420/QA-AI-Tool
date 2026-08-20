'use client';

import { Sparkles, Play, Loader2, ChevronDown, ChevronUp, Check, Plus, Download, Info } from 'lucide-react';
import type { TestCaseCategory } from '@/models/validators/test-case';
import type { TestCaseDiffEntry } from '@/services/test-case-diff';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';
import { SCROLLBAR } from './shared';
import { TestCaseCard } from './test-case-card';
import { FileDropzone, AttachedFileChip } from './workspace-ui';
import type { GenerateWorkspaceState } from '@/hooks/test-case/use-generate-workspace';

const DIMENSION_LABELS: Record<string, string> = {
  functional_positive: 'Functional Positive',
  functional_negative: 'Functional Negative',
  boundary_edge: 'Boundary/Edge',
  state_transition: 'State Transition',
  security: 'Security',
  performance: 'Performance',
  compatibility: 'Compatibility',
  integration: 'Integration',
  regression: 'Regression',
  accessibility: 'Accessibility',
  localization: 'Localization',
  audit_compliance: 'Audit/Compliance',
};

const SEVERITY_STYLE: Record<string, string> = {
  Critical: 'bg-danger-50 text-danger-600 border-danger-600/20',
  Major: 'bg-warning-50 text-warning-600 border-warning-600/20',
  Minor: 'bg-ink-100 text-ink-600 border-ink-200',
};

function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null;
  return (
    <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.Minor}`}>
      {severity}
    </span>
  );
}

function dimensionScoreTone(score: number) {
  if (score >= 80) return 'bg-success-600';
  if (score >= 60) return 'bg-warning-600';
  return 'bg-danger-600';
}

/** Preview "trước/sau" khi bấm Enhance — trước đây Enhance ghi đè testCases
 * ngay lập tức, không có cách nào xem lại AI vừa sửa gì hay quay lại nếu
 * không ưng ý. Giờ kết quả được giữ ở "pending" (xem use-generate-workspace.ts
 * pendingEnhance/enhanceDiff) cho tới khi người dùng bấm Áp dụng/Hủy. */
function EnhanceDiffPreview({ workspace, t }: { workspace: GenerateWorkspaceState; t: Dictionary }) {
  const diff = workspace.enhanceDiff;
  const ed = t.generateWorkspace.enhanceDiff;
  if (!diff) return null;

  const changed = diff.filter((entry) => entry.status !== 'unchanged');
  const unchangedCount = diff.length - changed.length;

  return (
    <div className="mb-4 animate-[fadeIn_0.2s_ease] rounded-2xl border-2 border-brand-200 bg-brand-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-brand-700">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            {ed.title}
          </p>
          <p className="mt-0.5 text-xs text-brand-500">
            {ed.subtitle(changed.length, unchangedCount > 0 ? ed.unchangedSuffix(unchangedCount) : '')}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={workspace.discardEnhancement} className="btn-secondary btn-sm">
            {ed.discardButton}
          </button>
          <button type="button" onClick={workspace.applyEnhancement} className="btn-primary btn-sm">
            <Check className="h-3.5 w-3.5" />
            {ed.applyButton}
          </button>
        </div>
      </div>

      {changed.length === 0 ? (
        <p className="rounded-xl bg-white p-3 text-xs italic text-ink-400">{ed.noChanges}</p>
      ) : (
        <div className={`max-h-96 space-y-2 overflow-y-auto ${SCROLLBAR}`}>
          {changed.map((entry: TestCaseDiffEntry) => (
            <div key={entry.code} className="rounded-xl border border-brand-100 bg-white p-3 text-xs">
              <p className="font-bold text-ink-800">
                <span className="font-mono text-brand-600">{entry.code}</span> — {entry.title}
                {entry.status === 'added' && <span className="badge-success ml-2 !py-0.5">{ed.newCaseBadge}</span>}
              </p>
              {entry.status === 'changed' && (
                <ul className="mt-2 space-y-1">
                  {entry.changes.map((c, i) => (
                    <li key={i}>
                      <span className="font-semibold text-ink-600">{c.label}:</span>{' '}
                      <span className="text-danger-600 line-through">{c.from || ed.empty}</span>{' '}
                      <span className="text-ink-400">→</span>{' '}
                      <span className="text-success-600">{c.to || ed.empty}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 12-dimension coverage radar as horizontal bars — the AI already computes these scores
 * on every review, they were just being discarded by the schema before; no charting lib
 * needed for 12 rows, plain bars read faster here anyway. */
function DimensionScoresPanel({ scores, title }: { scores: Record<string, number>; title: string }) {
  const entries = Object.entries(scores).filter(([, value]) => typeof value === 'number');
  if (entries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">{title}</p>
      <div className="space-y-2">
        {entries.map(([key, score]) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-[11px] font-semibold text-ink-600">{DIMENSION_LABELS[key] ?? key}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
              <div className={`h-full rounded-full ${dimensionScoreTone(score)}`} style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-[11px] font-bold text-ink-700">{score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Right column, "review" tab: choose a source, run the coverage review, and enhance with AI. */
export function ReviewPanel({ workspace }: { workspace: GenerateWorkspaceState }) {
  const { t } = workspace;
  const rp = t.generateWorkspace.reviewPanel;
  const activeReview = workspace.reviewMode === 'generated' ? workspace.review : workspace.importedReview;

  return (
    <div className="surface-card p-6">
      <div className="mb-5">
        <p className="text-eyebrow">{rp.step1Title}</p>
        <h2 className="text-h2 mt-1">{rp.heading}</h2>
        <p className="text-body mt-1">{rp.description}</p>
      </div>

      {/* Toggle mode */}
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-[var(--radius-control)] bg-ink-100 p-1">
        <button
          onClick={() => workspace.setReviewMode('generated')}
          className={`rounded-lg px-3 py-2.5 text-xs font-bold transition-all duration-150 ${workspace.reviewMode === 'generated' ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
        >
          {rp.sourceGeneratedLabel}
          <span className="mt-0.5 block font-normal text-[10px] text-ink-400">{rp.sourceGeneratedHint(workspace.safeTestCasesCount)}</span>
        </button>
        <button
          onClick={() => workspace.setReviewMode('imported')}
          className={`rounded-lg px-3 py-2.5 text-xs font-bold transition-all duration-150 ${workspace.reviewMode === 'imported' ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-500 hover:text-ink-700'}`}
        >
          {rp.sourceImportedLabel}
          <span className="mt-0.5 block font-normal text-[10px] text-ink-400">{rp.sourceImportedHint}</span>
        </button>
      </div>

      {/* Import file area (chỉ hiện khi mode = imported) */}
      {workspace.reviewMode === 'imported' && (
        <div className="mb-5 rounded-2xl border border-ink-100 bg-ink-50/60 p-4">
          <FileDropzone accept=".xlsx,.xls" onFile={workspace.handleReviewImportFile} icon={Download} label={rp.chooseFileLabel} hint={rp.chooseFileHint} />
          {workspace.importedReviewFileName && (
            <AttachedFileChip
              label={`${workspace.importedReviewFileName} (${workspace.importedReviewCases.length} cases)`}
              onRemove={workspace.clearImportedReviewFile}
              removeLabel={t.generateWorkspace.removeFile}
            />
          )}

          {workspace.importedReviewCases.length > 0 && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => workspace.setShowImportedCases((v) => !v)}
                  className="flex items-center gap-1 text-xs font-bold text-brand-600 transition-colors hover:text-brand-700 hover:underline"
                >
                  {workspace.showImportedCases ? rp.toggleHideCases : rp.toggleShowCases(workspace.importedReviewCases.length)}
                  {workspace.showImportedCases ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={workspace.exportImportedExcel} className="btn-secondary btn-sm">
                  <Download className="h-3.5 w-3.5" />
                  {t.generateWorkspace.exportButton}
                </button>
              </div>

              {workspace.showImportedCases && (
                <div className={`mt-3 max-h-96 space-y-5 overflow-y-auto rounded-2xl border border-ink-100 bg-ink-50/50 p-4 ${SCROLLBAR}`}>
                  {Object.entries(workspace.groupedImportedCases).map(([category, items]) => (
                    <div key={category}>
                      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-500">{workspace.getCategoryLabel(category as TestCaseCategory)}</h3>
                      <div className="space-y-3">
                        {(items ?? []).map((testCase) => (
                          <TestCaseCard key={`${testCase?.code}-${testCase?.title}`} testCase={testCase} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {workspace.reviewMode === 'generated' && workspace.safeTestCasesCount === 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-warning-600/20 bg-warning-50 p-3 text-sm text-warning-600">
          <Info className="h-4 w-4 shrink-0" />
          {rp.noGeneratedCasesNotice}
        </p>
      )}

      <p className="text-eyebrow mb-2">{rp.step2Title}</p>
      {workspace.reviewError && <div className="alert-danger mb-3 animate-[fadeIn_0.2s_ease] !p-3 text-xs">{workspace.reviewError}</div>}

      <EnhanceDiffPreview workspace={workspace} t={t} />

      {/* Review result */}
      {activeReview && (
        <div className="animate-[fadeIn_0.25s_ease] mb-4 space-y-4">
          {activeReview.summary && (
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm leading-6 text-ink-800">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-700">{rp.aiSummaryLabel}</p>
              {activeReview.summary}
            </div>
          )}

          <div className="flex items-center justify-between rounded-2xl bg-ink-50 px-4 py-3">
            <span className="text-sm font-semibold text-ink-700">{t.generateWorkspace.coverageLabel}</span>
            <span className={`text-2xl font-black ${activeReview.coverage_score >= 80 ? 'text-success-600' : 'text-warning-600'}`}>
              {activeReview.coverage_score}%
            </span>
          </div>

          {activeReview.dimension_scores && <DimensionScoresPanel scores={activeReview.dimension_scores as Record<string, number>} title={rp.dimensionScoresTitle} />}

          {activeReview.requirement_gaps?.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-warning-600">Requirement Gaps</p>
              <div className="space-y-2">
                {activeReview.requirement_gaps.map((gap, i) => (
                  <div key={i} className="rounded-xl border border-warning-600/20 bg-warning-50 p-3 text-sm transition-shadow hover:shadow-[var(--shadow-soft)]">
                    <p className="font-bold text-ink-900">
                      {gap.requirement_text}
                      <SeverityBadge severity={gap.severity} />
                      {gap.dimension && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-warning-600">{gap.dimension}</span>}
                    </p>
                    {gap.suggested_test_case && (
                      <button
                        onClick={() => (workspace.reviewMode === 'generated' ? workspace.acceptSuggestedCase : workspace.acceptSuggestedImportedCase)(gap.suggested_test_case!)}
                        className="btn-warning btn-sm mt-2"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {rp.addSuggestedCaseButton}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeReview.test_case_comments?.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Comments</p>
              <div className="space-y-2">
                {activeReview.test_case_comments.map((comment, i) => (
                  <div key={i} className="rounded-xl border border-ink-200 bg-ink-50 p-3 text-sm transition-shadow hover:shadow-[var(--shadow-soft)]">
                    <p className="font-bold text-ink-900">
                      {comment.test_case_code} – <span className="text-brand-600">{comment.issue_type}</span>
                      <SeverityBadge severity={comment.severity} />
                    </p>
                    <p className="mt-1 text-ink-600">{comment.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        <button
          disabled={workspace.isReviewing || !!workspace.pendingEnhance || (workspace.reviewMode === 'generated' && workspace.safeTestCasesCount === 0) || (workspace.reviewMode === 'imported' && workspace.importedReviewCases.length === 0)}
          onClick={workspace.runReview}
          className="btn-primary"
        >
          {workspace.isReviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {workspace.isReviewing ? rp.reviewingLabel : rp.runReviewButton}
        </button>

        {activeReview && (
          <button
            disabled={workspace.isEnhancing || !!workspace.pendingEnhance}
            onClick={workspace.runEnhance}
            className="btn border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:ring-brand-300"
          >
            {workspace.isEnhancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {workspace.isEnhancing ? rp.enhancingLabel : rp.enhanceButton}
          </button>
        )}
      </div>
    </div>
  );
}
