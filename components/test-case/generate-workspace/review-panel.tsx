'use client';

import type { TestCaseCategory } from '@/lib/validators/test-case';
import type { TestCaseDiffEntry } from '@/lib/test-case-diff';
import { SCROLLBAR } from './shared';
import { TestCaseCard } from './test-case-card';
import type { GenerateWorkspaceState } from './use-generate-workspace';

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
  Critical: 'bg-red-100 text-red-700 border-red-200',
  Major: 'bg-amber-100 text-amber-700 border-amber-200',
  Minor: 'bg-slate-100 text-slate-600 border-slate-200',
};

function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null;
  return (
    <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.Minor}`}>
      {severity}
    </span>
  );
}

function dimensionScoreTone(score: number) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-red-500';
}

/** Preview "trước/sau" khi bấm Enhance — trước đây Enhance ghi đè testCases
 * ngay lập tức, không có cách nào xem lại AI vừa sửa gì hay quay lại nếu
 * không ưng ý. Giờ kết quả được giữ ở "pending" (xem use-generate-workspace.ts
 * pendingEnhance/enhanceDiff) cho tới khi người dùng bấm Áp dụng/Hủy. */
function EnhanceDiffPreview({ workspace }: { workspace: GenerateWorkspaceState }) {
  const diff = workspace.enhanceDiff;
  if (!diff) return null;

  const changed = diff.filter((entry) => entry.status !== 'unchanged');
  const unchangedCount = diff.length - changed.length;

  return (
    <div className="mb-4 animate-[fadeIn_0.2s_ease] rounded-2xl border-2 border-purple-200 bg-purple-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-purple-700">✨ Xem trước kết quả Enhance</p>
          <p className="mt-0.5 text-xs text-purple-500">
            {changed.length} case có thay đổi
            {unchangedCount > 0 && ` · ${unchangedCount} case giữ nguyên`} — chưa được lưu, bạn xem và quyết định bên dưới.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={workspace.discardEnhancement}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50"
          >
            Hủy, giữ bản cũ
          </button>
          <button
            type="button"
            onClick={workspace.applyEnhancement}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-purple-700 active:scale-[0.98]"
          >
            ✓ Áp dụng thay đổi
          </button>
        </div>
      </div>

      {changed.length === 0 ? (
        <p className="rounded-xl bg-white p-3 text-xs italic text-slate-400">AI không đề xuất thay đổi nào khác so với bản hiện tại.</p>
      ) : (
        <div className={`max-h-96 space-y-2 overflow-y-auto ${SCROLLBAR}`}>
          {changed.map((entry: TestCaseDiffEntry) => (
            <div key={entry.code} className="rounded-xl border border-purple-100 bg-white p-3 text-xs">
              <p className="font-bold text-slate-800">
                <span className="font-mono text-purple-600">{entry.code}</span> — {entry.title}
                {entry.status === 'added' && <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-700">Case mới</span>}
              </p>
              {entry.status === 'changed' && (
                <ul className="mt-2 space-y-1">
                  {entry.changes.map((c, i) => (
                    <li key={i}>
                      <span className="font-semibold text-slate-600">{c.label}:</span>{' '}
                      <span className="text-red-500 line-through">{c.from || '(trống)'}</span>{' '}
                      <span className="text-slate-400">→</span>{' '}
                      <span className="text-emerald-700">{c.to || '(trống)'}</span>
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
function DimensionScoresPanel({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores).filter(([, value]) => typeof value === 'number');
  if (entries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4">
      <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">Coverage theo 12 chiều chất lượng</p>
      <div className="space-y-2">
        {entries.map(([key, score]) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-[11px] font-semibold text-slate-600">{DIMENSION_LABELS[key] ?? key}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${dimensionScoreTone(score)}`} style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right text-[11px] font-bold text-slate-700">{score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Right column, "review" tab: choose a source, run the coverage review, and enhance with AI. */
export function ReviewPanel({ workspace }: { workspace: GenerateWorkspaceState }) {
  const activeReview = workspace.reviewMode === 'generated' ? workspace.review : workspace.importedReview;

  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_2px_20px_-4px_rgba(15,23,42,0.06)] backdrop-blur-sm">
      <div className="mb-5">
        <p className="text-xs font-black uppercase tracking-widest text-purple-600">Bước 1 · Chọn nguồn cần review</p>
        <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">Review & Enhance với AI</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">AI sẽ chấm coverage so với requirement, chỉ ra lỗ hổng và cho phép tự động cải thiện bộ test case.</p>
      </div>

      {/* Toggle mode */}
      <div className="mb-5 grid grid-cols-2 gap-1.5 rounded-2xl bg-slate-100 p-1">
        <button
          onClick={() => workspace.setReviewMode('generated')}
          className={`rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-200 ${workspace.reviewMode === 'generated' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Bộ vừa generate
          <span className="mt-0.5 block font-normal text-[10px] text-slate-400">{workspace.safeTestCasesCount} test case ở tab Kết quả</span>
        </button>
        <button
          onClick={() => workspace.setReviewMode('imported')}
          className={`rounded-xl px-3 py-2.5 text-xs font-bold transition-all duration-200 ${workspace.reviewMode === 'imported' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          File Excel import
          <span className="mt-0.5 block font-normal text-[10px] text-slate-400">Review bộ test case cũ từ .xlsx</span>
        </button>
      </div>

      {/* Import file area (chỉ hiện khi mode = imported) */}
      {workspace.reviewMode === 'imported' && (
        <div className="mb-5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-slate-200 bg-white p-4 text-center transition-all hover:border-purple-300 hover:bg-purple-50/20">
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) workspace.handleReviewImportFile(file);
                event.target.value = '';
              }}
            />
            <svg className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M12 12v9m0-9l-3 3m3-3l3 3" />
            </svg>
            <span className="text-sm font-semibold text-slate-700">Chọn file .xlsx để review</span>
            <span className="text-xs text-slate-400">File sẽ được parse và review bởi AI</span>
          </label>
          {workspace.importedReviewFileName && (
            <div className="mt-2 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs">
              <span className="font-semibold text-slate-700">{workspace.importedReviewFileName} ({workspace.importedReviewCases.length} cases)</span>
              <button
                type="button"
                onClick={workspace.clearImportedReviewFile}
                className="font-bold text-red-500 transition-colors hover:text-red-600 hover:underline"
              >
                Xóa
              </button>
            </div>
          )}

          {workspace.importedReviewCases.length > 0 && (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => workspace.setShowImportedCases((v) => !v)}
                  className="text-xs font-bold text-purple-600 transition-colors hover:text-purple-700 hover:underline"
                >
                  {workspace.showImportedCases ? 'Ẩn danh sách test case' : `Xem ${workspace.importedReviewCases.length} test case`}
                </button>
                <button
                  type="button"
                  onClick={workspace.exportImportedExcel}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 transition-all hover:border-emerald-200 hover:shadow-sm"
                >
                  Export Excel (.xlsx)
                </button>
              </div>

              {workspace.showImportedCases && (
                <div className={`mt-3 max-h-96 space-y-5 overflow-y-auto rounded-2xl border border-slate-100 bg-slate-50/50 p-4 ${SCROLLBAR}`}>
                  {Object.entries(workspace.groupedImportedCases).map(([category, items]) => (
                    <div key={category}>
                      <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">{workspace.getCategoryLabel(category as TestCaseCategory)}</h3>
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
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">Chưa có test case nào được generate. Hãy generate ở bước 1 trước, hoặc chuyển sang "File Excel import".</p>
      )}

      <p className="mb-2 text-xs font-black uppercase tracking-widest text-purple-600">Bước 2 · Chạy review & xem kết quả</p>
      {workspace.reviewError && <div className="animate-[fadeIn_0.2s_ease] rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700 mb-3">{workspace.reviewError}</div>}

      <EnhanceDiffPreview workspace={workspace} />

      {/* Review result */}
      {activeReview && (
        <div className="animate-[fadeIn_0.25s_ease] space-y-4 mb-4">
          {activeReview.summary && (
            <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-4 text-sm leading-6 text-purple-900">
              <p className="mb-1 text-xs font-black uppercase tracking-wide text-purple-600">Tóm tắt của AI</p>
              {activeReview.summary}
            </div>
          )}

          <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
            <span className="text-sm font-bold text-slate-700">Coverage Score</span>
            <span className={`text-2xl font-black ${activeReview.coverage_score >= 80 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {activeReview.coverage_score}%
            </span>
          </div>

          {activeReview.dimension_scores && <DimensionScoresPanel scores={activeReview.dimension_scores as Record<string, number>} />}

          {activeReview.requirement_gaps?.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-amber-600 mb-2">Requirement Gaps</p>
              <div className="space-y-2">
                {activeReview.requirement_gaps.map((gap, i) => (
                  <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm transition-shadow hover:shadow-sm">
                    <p className="font-bold text-amber-900">
                      {gap.requirement_text}
                      <SeverityBadge severity={gap.severity} />
                      {gap.dimension && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-500">{gap.dimension}</span>}
                    </p>
                    {gap.suggested_test_case && (
                      <button
                        onClick={() =>
                          (workspace.reviewMode === 'generated' ? workspace.acceptSuggestedCase : workspace.acceptSuggestedImportedCase)(gap.suggested_test_case!)
                        }
                        className="mt-2 rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white transition-all hover:bg-amber-700 active:scale-[0.98]"
                      >
                        + Thêm test case đề xuất
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeReview.test_case_comments?.length > 0 && (
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-500 mb-2">Comments</p>
              <div className="space-y-2">
                {activeReview.test_case_comments.map((comment, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm transition-shadow hover:shadow-sm">
                    <p className="font-bold text-slate-900">
                      {comment.test_case_code} – <span className="text-purple-600">{comment.issue_type}</span>
                      <SeverityBadge severity={comment.severity} />
                    </p>
                    <p className="mt-1 text-slate-600">{comment.comment}</p>
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
          className="rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm shadow-purple-200 transition-all hover:shadow-md hover:shadow-purple-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {workspace.isReviewing ? 'Đang review...' : '▶ Chạy Review'}
        </button>

        {activeReview && (
          <button
            disabled={workspace.isEnhancing || !!workspace.pendingEnhance}
            onClick={workspace.runEnhance}
            className="rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5 text-sm font-bold text-purple-700 transition-all hover:bg-purple-100 hover:shadow-sm active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {workspace.isEnhancing ? 'Đang enhance...' : '✨ Enhance with AI'}
          </button>
        )}
      </div>
    </div>
  );
}
