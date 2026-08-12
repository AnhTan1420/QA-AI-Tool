import Link from 'next/link';
import { Brain, CheckCircle2, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getLocale } from '@/lib/i18n/get-locale';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPriorityStyle } from '@/lib/test-case-taxonomy';
import { BackLink } from '@/components/layout/back-link';

export default async function GenerateResultPage({ params }: { params: Promise<{ projectId: string; setId: string }> }) {
  const { projectId, setId } = await params;
  const supabase = await createClient();
  const locale = await getLocale();
  const t = getDictionary(locale);

  const { data: set } = await supabase
    .from('test_case_sets')
    .select('id, status, generated_by_model, created_at, analysis, requirements(title, description)')
    .eq('id', setId)
    .single();

  const { data: testCases } = await supabase
    .from('test_cases')
    .select('id, code, title, category, priority, status, expected_result')
    .eq('set_id', setId)
    .order('created_at', { ascending: true });

  const { data: review } = await supabase
    .from('ai_reviews')
    .select('coverage_score, review_payload, reviewed_at')
    .eq('set_id', setId)
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!set) {
    return <div className="alert-danger text-center">{t.generateResult.notFound}</div>;
  }

  const requirement = Array.isArray(set.requirements) ? set.requirements[0] : set.requirements;
  const coverageTone = review && review.coverage_score >= 80 ? 'text-success-600' : 'text-warning-600';

  return (
    <div className="space-y-6">
      <BackLink href={`/projects/${projectId}/test-cases`} label={t.generateResult.back} />

      <div className="surface-card p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-eyebrow">{t.generateResult.eyebrow}</p>
            <h1 className="text-h1 mt-2">{requirement?.title ?? t.generateResult.requirementFallback}</h1>
            <p className="text-body mt-2 max-w-2xl">{requirement?.description}</p>
          </div>
          {review && (
            <div className="rounded-[var(--radius-control)] bg-ink-50 px-4 py-2 text-right">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">{t.generateResult.coverageLabel}</p>
              <p className={`text-3xl font-black ${coverageTone}`}>{review.coverage_score}%</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold">
          <span className="badge-neutral">{testCases?.length ?? 0} {t.generateResult.testCaseSuffix}</span>
          <span className="badge-neutral">{t.generateResult.statusPrefix}: {set.status}</span>
          {set.generated_by_model && <span className="badge-neutral">{t.generateResult.modelPrefix}: {set.generated_by_model}</span>}
        </div>
      </div>

      {review?.review_payload?.summary && (
        <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-6 text-sm leading-6 text-ink-800">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-700">Tóm tắt Review của AI</p>
          {review.review_payload.summary}
        </div>
      )}

      {set.analysis && (
        <details className="surface-card group p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-ink-700">
            <span className="flex items-center gap-2">
              <Brain className="h-4 w-4 shrink-0 text-brand-600" />
              AI Reasoning lúc generate
              {set.analysis.input_source && <span className="font-normal normal-case text-ink-400">· nguồn: {set.analysis.input_source}</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-4 space-y-4 text-sm">
            {Array.isArray(set.analysis.coverage_self_check) && set.analysis.coverage_self_check.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">AI tự kiểm tra độ phủ</p>
                <ul className="space-y-1 text-xs text-ink-600">
                  {set.analysis.coverage_self_check.map((item: string, i: number) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success-600" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(set.analysis.risk_ranking) && set.analysis.risk_ranking.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-500">Xếp hạng rủi ro (FMEA)</p>
                <ul className="space-y-1 text-xs text-ink-600">
                  {set.analysis.risk_ranking.map((risk: Record<string, unknown>, i: number) => (
                    <li key={i}>• {String(risk.scenario)} → <span className="font-bold text-ink-800">{String(risk.resulting_priority)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="surface-card overflow-hidden">
        <div className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-ink-200 bg-ink-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-ink-500">
          <span>{t.generateResult.colCode}</span>
          <span>{t.generateResult.colTitle}</span>
          <span>{t.generateResult.colCategory}</span>
          <span>{t.generateResult.colPriority}</span>
          <span>{t.generateResult.colStatus}</span>
        </div>
        {(!testCases || testCases.length === 0) && <div className="p-8 text-center text-ink-500">{t.generateResult.empty}</div>}
        {testCases?.map((testCase) => (
          <Link
            key={testCase.id}
            href={`/projects/${projectId}/test-cases/${testCase.id}`}
            className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-ink-100 px-5 py-4 text-sm transition-colors last:border-b-0 hover:bg-brand-50/50"
          >
            <span className="font-mono font-bold text-brand-700">{testCase.code}</span>
            <span className="font-semibold text-ink-900">{testCase.title}</span>
            <span className="text-ink-600">{testCase.category}</span>
            <span>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${getPriorityStyle(testCase.priority)}`}>{testCase.priority}</span>
            </span>
            <span className="text-ink-600">{testCase.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
