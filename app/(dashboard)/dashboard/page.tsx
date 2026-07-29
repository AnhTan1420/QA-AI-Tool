import Link from 'next/link';
import { FolderKanban, FileStack, ListTree, Wrench, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { count: projectCount } = await supabase.from('projects').select('*', { count: 'exact', head: true });
  const { count: testCaseCount } = await supabase.from('test_cases').select('*', { count: 'exact', head: true });

  const metrics = [
    { label: 'Projects của bạn', value: String(projectCount ?? 0), icon: FolderKanban },
    { label: 'Test case đã lưu', value: String(testCaseCount ?? 0), icon: FileStack },
    { label: 'Taxonomy hỗ trợ', value: '11', icon: ListTree },
  ];

  return (
    <div className="space-y-10">
      <div>
        <p className="text-eyebrow">Overview</p>
        <h1 className="text-h1 mt-2">
          {user ? `Chào, ${user.user_metadata?.full_name ?? user.email}` : 'QAForge Dashboard'}
        </h1>
        <p className="text-body mt-3 max-w-2xl">
          Theo dõi workflow tạo test case, review coverage và truy cập nhanh các công cụ tester.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="surface-card p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <metric.icon className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <p className="text-caption mt-4">{metric.label}</p>
            <p className="text-display mt-1 text-4xl">{metric.value}</p>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-h2 mb-4">Bắt đầu nhanh</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Link href="/tools" className="surface-card-interactive group p-7">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-100 text-ink-700">
              <Wrench className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <h3 className="text-h3 mt-5">Mở QA Utility Toolkit</h3>
            <p className="text-body mt-2">JSON, Base64, UUID, Regex, Hash và Timestamp chạy client-side.</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
              Khám phá toolkit
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>

          <Link
            href="/projects"
            className="group relative overflow-hidden rounded-[var(--radius-card)] bg-brand-600 p-7 text-white shadow-[var(--shadow-soft)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-brand)]"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-white">
              <FolderKanban className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <h3 className="mt-5 text-lg font-bold">Mở Projects</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-50">
              Tạo project mới hoặc tiếp tục generate test case bằng AI.
            </p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
              Xem projects
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
