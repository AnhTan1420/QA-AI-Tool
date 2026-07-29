import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { count: projectCount } = await supabase.from('projects').select('*', { count: 'exact', head: true });
  const { count: testCaseCount } = await supabase.from('test_cases').select('*', { count: 'exact', head: true });

  const metrics = [
    { label: 'Projects của bạn', value: String(projectCount ?? 0) },
    { label: 'Test case đã lưu', value: String(testCaseCount ?? 0) },
    { label: 'Taxonomy hỗ trợ', value: '11' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Overview</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">
          {user ? `Chào, ${user.user_metadata?.full_name ?? user.email}` : 'QAForge Dashboard'}
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">Theo dõi workflow tạo test case, review coverage và truy cập nhanh các công cụ tester.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-500">{metric.label}</p>
            <p className="mt-2 text-4xl font-black text-slate-950">{metric.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Link href="/tools" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-200">
          <h2 className="text-xl font-bold text-slate-950">Mở QA Utility Toolkit</h2>
          <p className="mt-2 text-slate-600">JSON, Base64, UUID, Regex, Hash và Timestamp chạy client-side.</p>
        </Link>
        <Link href="/projects" className="rounded-3xl border border-blue-200 bg-blue-600 p-6 text-white shadow-sm hover:bg-blue-700">
          <h2 className="text-xl font-bold">Mở Projects</h2>
          <p className="mt-2 text-blue-50">Tạo project mới hoặc tiếp tục generate test case bằng AI.</p>
        </Link>
      </div>
    </div>
  );
}
