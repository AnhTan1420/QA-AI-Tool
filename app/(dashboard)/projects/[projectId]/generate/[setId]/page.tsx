export default async function GenerateResultPage({ params }: { params: Promise<{ projectId: string; setId: string }> }) {
  const { projectId, setId } = await params;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Generated result</p>
      <h1 className="mt-2 text-3xl font-black text-slate-950">Set {setId}</h1>
      <p className="mt-2 text-slate-600">Project {projectId}. Trang này sẵn sàng nối dữ liệu Supabase cho generated set, review panel và inline edit.</p>
    </div>
  );
}
