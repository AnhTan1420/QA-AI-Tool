import Link from 'next/link';

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Projects</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Thư viện test case</h1>
          <p className="mt-2 text-slate-600">MVP dùng project demo; Supabase Auth/RLS đã được chuẩn bị trong schema.</p>
        </div>
        <Link href="/projects/demo/generate" className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700">
          Generate cho project demo
        </Link>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">Demo Project</h2>
        <p className="mt-2 text-slate-600">Không gian thử nghiệm flow description → generate → review → chỉnh sửa → export.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/projects/demo" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:text-blue-700">Xem thư viện</Link>
          <Link href="/projects/demo/team" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:text-blue-700">Team</Link>
        </div>
      </div>
    </div>
  );
}
