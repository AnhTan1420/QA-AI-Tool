import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function GenerateResultPage({ params }: { params: Promise<{ projectId: string; setId: string }> }) {
  const { projectId, setId } = await params;
  const supabase = await createClient();

  const { data: set } = await supabase
    .from('test_case_sets')
    .select('id, status, generated_by_model, created_at, requirements(title, description)')
    .eq('id', setId)
    .single();

  const { data: testCases } = await supabase
    .from('test_cases')
    .select('id, code, title, category, priority, status, expected_result')
    .eq('set_id', setId)
    .order('created_at', { ascending: true });

  const { data: review } = await supabase
    .from('ai_reviews')
    .select('coverage_score, reviewed_at')
    .eq('set_id', setId)
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!set) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-red-700 shadow-sm">
        Không tìm thấy generated set này (có thể bạn không phải thành viên của project).
      </div>
    );
  }

  const requirement = Array.isArray(set.requirements) ? set.requirements[0] : set.requirements;

  return (
    <div className="space-y-6">
      <Link href={`/projects/${projectId}/test-cases`} className="text-sm font-semibold text-blue-600">← Xem toàn bộ thư viện</Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Generated set</p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">{requirement?.title ?? 'Requirement'}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">{requirement?.description}</p>
          </div>
          {review && (
            <div className="text-right">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Coverage score</p>
              <p className="text-4xl font-black text-emerald-600">{review.coverage_score}%</p>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">{testCases?.length ?? 0} test case</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">Trạng thái set: {set.status}</span>
          {set.generated_by_model && <span className="rounded-full bg-slate-100 px-3 py-1">Model: {set.generated_by_model}</span>}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-black uppercase tracking-wide text-slate-500">
          <span>Code</span>
          <span>Title</span>
          <span>Category</span>
          <span>Priority</span>
          <span>Status</span>
        </div>
        {(!testCases || testCases.length === 0) && <div className="p-8 text-center text-slate-500">Set này chưa có test case nào.</div>}
        {testCases?.map((testCase) => (
          <Link
            key={testCase.id}
            href={`/projects/${projectId}/test-cases/${testCase.id}`}
            className="grid grid-cols-[0.8fr_2fr_1fr_0.8fr_1fr] gap-4 border-b border-slate-100 px-5 py-4 text-sm last:border-b-0 hover:bg-blue-50/50"
          >
            <span className="font-mono font-bold text-blue-700">{testCase.code}</span>
            <span className="font-semibold text-slate-950">{testCase.title}</span>
            <span className="text-slate-600">{testCase.category}</span>
            <span className="font-bold text-slate-700">{testCase.priority}</span>
            <span className="text-slate-600">{testCase.status}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
