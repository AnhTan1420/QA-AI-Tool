import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getLocale } from '@/lib/i18n/get-locale';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPriorityStyle } from '@/lib/test-case-taxonomy';

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
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-red-700 shadow-sm">
        {t.generateResult.notFound}
      </div>
    );
  }

  const requirement = Array.isArray(set.requirements) ? set.requirements[0] : set.requirements;

  return (
    <div className="space-y-6">
      <Link href={`/projects/${projectId}/test-cases`} className="text-sm font-semibold text-blue-600">{t.generateResult.back}</Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{t.generateResult.eyebrow}</p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">{requirement?.title ?? t.generateResult.requirementFallback}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">{requirement?.description}</p>
          </div>
          {review && (
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t.generateResult.coverageLabel}</p>
              <p className="text-4xl font-black text-emerald-600">{review.coverage_score}%</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">{testCases?.length ?? 0} {t.generateResult.testCaseSuffix}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{t.generateResult.statusPrefix}: {set.status}</span>
          {set.generated_by_model && <span className="rounded-full bg-slate-100 px-3 py-1">{t.generateResult.modelPrefix}: {set.generated_by_model}</span>}
        </div>
      </div>

      {review?.review_payload?.summary && (
        <div className="rounded-3xl border border-purple-100 bg-purple-50/60 p-6 text-sm leading-6 text-purple-900 shadow-sm">
          <p className="mb-1 text-xs font-black uppercase tracking-wide text-purple-600">Tóm tắt Review của AI</p>
          {review.review_payload.summary}
        </div>
      )}

      {set.analysis && (
        <details className="rounded-3xl border border-indigo-100 bg-indigo-50/40 p-6 shadow-sm">
          <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-indigo-700">
            🧠 AI Reasoning lúc generate {set.analysis.input_source && <span className="ml-1 font-normal normal-case text-indigo-400">· nguồn: {set.analysis.input_source}</span>}
          </summary>
          <div className="mt-4 space-y-4 text-sm">
            {Array.isArray(set.analysis.coverage_self_check) && set.analysis.coverage_self_check.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wide text-indigo-600">AI tự kiểm tra độ phủ</p>
                <ul className="space-y-1 text-xs text-slate-600">
                  {set.analysis.coverage_self_check.map((item: string, i: number) => <li key={i}>✓ {item}</li>)}
                </ul>
              </div>
            )}
            {Array.isArray(set.analysis.risk_ranking) && set.analysis.risk_ranking.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-black uppercase tracking-wide text-indigo-600">Xếp hạng rủi ro (FMEA)</p>
                <ul className="space-y-1 text-xs text-slate-600">
                  {set.analysis.risk_ranking.map((risk: Record<string, unknown>, i: number) => (
                    <li key={i}>• {String(risk.scenario)} → <span className="font-bold">{String(risk.resulting_priority)}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
          <span>{t.generateResult.colCode}</span>
          <span>{t.generateResult.colTitle}</span>
          <span>{t.generateResult.colCategory}</span>
          <span>{t.generateResult.colPriority}</span>
          <span>{t.generateResult.colStatus}</span>
        </div>
        {(!testCases || testCases.length === 0) && <div className="p-8 text-center text-slate-500">{t.generateResult.empty}</div>}
        {testCases?.map((testCase) => (
          <Link
            key={testCase.id}
            href={`/projects/${projectId}/test-cases/${testCase.id}`}
            className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-slate-100 px-5 py-4 text-sm last:border-b-0 hover:bg-blue-50/50"
          >
            <span className="font-mono font-bold text-blue-700">{testCase.code}</span>
            <span className="font-semibold text-slate-950">{testCase.title}</span>
            <span className="text-slate-600">{testCase.category}</span>
            <span>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${getPriorityStyle(testCase.priority)}`}>{testCase.priority}</span>
            </span>
            <span className="text-slate-600">{testCase.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
