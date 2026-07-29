'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  async function loadProjects() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/projects');
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? 'Không thể tải projects');
      setProjects(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải projects');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    setIsCreating(true);
    setError('');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? 'Không thể tạo project');
      setName('');
      setDescription('');
      setShowForm(false);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tạo project');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Projects</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950">Thư viện test case</h1>
          <p className="mt-2 text-slate-600">Mỗi project có thư viện test case, quyền thành viên và vòng lặp học lại riêng.</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700">
          {showForm ? 'Đóng' : '+ Tạo project mới'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProject} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Tên project</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="Ví dụ: Mobile Banking App" />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700">Mô tả (optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" rows={2} />
          </label>
          <button type="submit" disabled={isCreating} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {isCreating ? 'Đang tạo...' : 'Tạo project'}
          </button>
        </form>
      )}

      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-950">Sandbox demo</h2>
        <p className="mt-2 text-slate-600">Không gian thử nghiệm flow description → generate → review, kết quả không lưu vào Supabase.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/projects/demo/generate" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:text-blue-700">Thử generate</Link>
        </div>
      </div>

      {loading && <div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center text-slate-500">Đang tải projects...</div>}

      {!loading && projects.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center text-slate-500">
          Chưa có project nào. Bấm &quot;Tạo project mới&quot; để bắt đầu.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
            <h2 className="text-lg font-bold text-slate-950">{project.name}</h2>
            <p className="mt-2 line-clamp-2 text-sm text-slate-600">{project.description || 'Chưa có mô tả.'}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
