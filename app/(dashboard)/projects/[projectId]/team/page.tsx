export default async function TeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Team & roles</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">Project {projectId}</h1>
        <p className="mt-2 text-slate-600">Role model: qa, senior_qa, admin. RLS policy trong schema giới hạn dữ liệu theo project_members.</p>
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          {['qa', 'senior_qa', 'admin'].map((role) => (
            <div key={role} className="rounded-2xl bg-slate-50 p-4">
              <p className="font-mono text-sm font-bold text-slate-950">{role}</p>
              <p className="mt-1 text-sm text-slate-600">Chuẩn bị cho Supabase Auth và project-level override.</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
