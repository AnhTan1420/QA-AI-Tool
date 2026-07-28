export default async function TestCaseDetailPage({ params }: { params: Promise<{ projectId: string; caseId: string }> }) {
  const { projectId, caseId } = await params;
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Test case detail</p>
      <h1 className="mt-2 text-3xl font-black text-slate-950">{caseId}</h1>
      <p className="mt-2 text-slate-600">Project {projectId}. Khu vực dành cho version history, comment realtime và approve workflow.</p>
    </div>
  );
}
