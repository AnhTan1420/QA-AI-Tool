import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let projectName = projectId;
  let projectDescription = '';

  if (projectId !== 'demo') {
    const supabase = await createClient();
    const { data } = await supabase.from('projects').select('name, description').eq('id', projectId).single();
    if (data) {
      projectName = data.name;
      projectDescription = data.description ?? '';
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Project</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{projectName}</h1>
        <p className="mt-2 text-slate-600">{projectDescription || 'Thư viện test case và vòng lặp học lại cho các lần generate sau.'}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Link href={`/projects/${projectId}/generate`} className="rounded-3xl border border-blue-200 bg-blue-600 p-6 text-white shadow-sm hover:bg-blue-700">
          <h2 className="text-xl font-bold">Generate</h2>
          <p className="mt-2 text-sm text-blue-50">Tạo test case mới từ requirement.</p>
        </Link>
        <Link href={`/projects/${projectId}/test-cases`} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-200">
          <h2 className="text-xl font-bold text-slate-950">Test cases</h2>
          <p className="mt-2 text-sm text-slate-600">Xem danh sách test case đã lưu.</p>
        </Link>
        <Link href={`/projects/${projectId}/team`} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:border-blue-200">
          <h2 className="text-xl font-bold text-slate-950">Team</h2>
          <p className="mt-2 text-sm text-slate-600">Quản lý vai trò QA/Senior QA/Admin.</p>
        </Link>
      </div>
    </div>
  );
}
