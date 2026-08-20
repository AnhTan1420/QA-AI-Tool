import Link from 'next/link';
import { FolderKanban, FileStack, ListTree, Wrench, ArrowRight } from 'lucide-react';
import { createClient } from '@/services/supabase/server';
import { getLocale } from '@/lib/i18n/get-locale';
import { getDictionary } from '@/lib/i18n/dictionaries';

export default async function DashboardPage() {
  const supabase = await createClient();
  const locale = await getLocale();
  const t = getDictionary(locale);

  // 3 request độc lập (auth + 2 count) trước đây chạy tuần tự (await từng cái), cộng dồn
  // độ trễ mạng của cả 3. Chạy song song bằng Promise.all vì không cái nào phụ thuộc
  // kết quả của cái kia. Ngoài ra count: 'exact' luôn ép Postgres seq scan toàn bảng để
  // đếm chính xác (COUNT(*) không dùng được index-only scan) - với một con số hiển thị
  // trên thẻ dashboard thì không cần chính xác tuyệt đối, nên đổi sang 'estimated'
  // (dùng thống kê planner, gần như tức thời, không scan bảng) để nhanh hơn nhiều khi
  // bảng lớn dần.
  const [
    { data: { user } },
    { count: projectCount },
    { count: testCaseCount },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('projects').select('*', { count: 'estimated', head: true }),
    supabase.from('test_cases').select('*', { count: 'estimated', head: true }),
  ]);

  const metrics = [
    { label: t.dashboard.metricProjects, value: String(projectCount ?? 0), icon: FolderKanban },
    { label: t.dashboard.metricTestCases, value: String(testCaseCount ?? 0), icon: FileStack },
    { label: t.dashboard.metricTaxonomy, value: '11', icon: ListTree },
  ];

  return (
    <div className="space-y-10">
      <div>
        <p className="text-eyebrow">{t.dashboard.eyebrow}</p>
        <h1 className="text-h1 mt-2">
          {user ? `${t.dashboard.greeting} ${user.user_metadata?.full_name ?? user.email}` : t.dashboard.titleFallback}
        </h1>
        <p className="text-body mt-3 max-w-2xl">{t.dashboard.subtitle}</p>
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
        <h2 className="text-h2 mb-4">{t.dashboard.quickStart}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Link href="/tools" className="surface-card-interactive group p-7">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-100 text-ink-700">
              <Wrench className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <h3 className="text-h3 mt-5">{t.dashboard.openToolkitTitle}</h3>
            <p className="text-body mt-2">{t.dashboard.openToolkitDesc}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600">
              {t.dashboard.exploreToolkit}
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
            <h3 className="mt-5 text-lg font-bold">{t.dashboard.openProjectsTitle}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-50">{t.dashboard.openProjectsDesc}</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
              {t.dashboard.viewProjects}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
