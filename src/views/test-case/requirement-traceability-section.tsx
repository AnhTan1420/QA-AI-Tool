import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';

export type RequirementTraceabilityRow = {
  clause: string;
  isCovered: boolean;
  coveredBy: { id: string; code: string; title: string }[];
};

/**
 * Requirement Traceability Matrix da PERSIST (bang requirement_traceability) -
 * khac voi <TraceabilityMatrix> trong views/test-case/generate-workspace
 * (bang do la doc-atom coverage TAM THOI, tinh lai moi lan generate tu
 * document_context, khong luu DB). Component nay hien du lieu da luu qua
 * POST /api/test-case-sets/[setId]/traceability, doc lai boi
 * app/(dashboard)/projects/[projectId]/generate/[setId]/page.tsx.
 */
export function RequirementTraceabilitySection({
  rows,
  projectId,
  t,
}: {
  rows: RequirementTraceabilityRow[];
  projectId: string;
  t: Dictionary;
}) {
  const tm = t.generateResult.traceability;
  if (rows.length === 0) return null;

  const coveredCount = rows.filter((r) => r.isCovered).length;
  const coveragePct = Math.round((coveredCount / rows.length) * 100);
  const tone = coveragePct >= 80 ? 'text-success-600' : 'text-warning-600';

  return (
    <div className="surface-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-5 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-700">{tm.title}</p>
          <p className="mt-0.5 text-xs text-ink-500">{tm.subtitle}</p>
        </div>
        <span className={`text-lg font-black ${tone}`}>
          {coveredCount}/{rows.length} <span className="text-xs font-bold text-ink-400">({coveragePct}%)</span>
        </span>
      </div>
      <div className="divide-y divide-ink-100">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
            <div className="mt-0.5 shrink-0">
              {row.isCovered ? (
                <CheckCircle2 className="h-4 w-4 text-success-600" />
              ) : (
                <XCircle className="h-4 w-4 text-warning-600" />
              )}
            </div>
            <p className="min-w-[240px] flex-1 text-ink-800">{row.clause}</p>
            <div className="flex flex-wrap gap-1.5">
              {row.coveredBy.length === 0 ? (
                <span className="badge-warning">{tm.notCovered}</span>
              ) : (
                row.coveredBy.map((tc) => (
                  <Link
                    key={tc.id}
                    href={`/projects/${projectId}/test-cases/${tc.id}`}
                    className="rounded bg-success-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-success-600 hover:bg-success-100"
                    title={tc.title}
                  >
                    {tc.code}
                  </Link>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
