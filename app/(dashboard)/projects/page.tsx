'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, X, FlaskConical, ArrowRight, FolderKanban } from 'lucide-react';

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
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">Projects</p>
          <h1 className="text-h1 mt-2">Thư viện test case</h1>
          <p className="text-body mt-2 max-w-2xl">
            Mỗi project có thư viện test case, quyền thành viên và vòng lặp học lại riêng.
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className={showForm ? 'btn-secondary' : 'btn-primary'}>
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Đóng' : 'Tạo project mới'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProject} className="surface-card space-y-5 p-6">
          <label className="block">
            <span className="field-label">Tên project</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="field-input" placeholder="Ví dụ: Mobile Banking App" />
          </label>
          <label className="block">
            <span className="field-label">Mô tả (optional)</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="field-input" rows={2} />
          </label>
          <button type="submit" disabled={isCreating} className="btn-primary">
            {isCreating ? 'Đang tạo...' : 'Tạo project'}
          </button>
        </form>
      )}

      {error && <div className="alert-danger">{error}</div>}

      <div className="surface-card p-6">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-700">
            <FlaskConical className="h-5 w-5" strokeWidth={2.25} />
          </span>
          <div>
            <h2 className="text-h3">Sandbox demo</h2>
            <p className="text-body mt-1">
              Không gian thử nghiệm flow description → generate → review, kết quả không lưu vào Supabase.
            </p>
            <Link href="/projects/demo/generate" className="btn-secondary mt-4">
              Thử generate
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 p-10 text-center text-ink-500">
          Đang tải projects...
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 p-10 text-center text-ink-500">
          Chưa có project nào. Bấm &quot;Tạo project mới&quot; để bắt đầu.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`} className="surface-card-interactive p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <FolderKanban className="h-5 w-5" strokeWidth={2.25} />
            </span>
            <h2 className="text-h3 mt-4">{project.name}</h2>
            <p className="text-body mt-2 line-clamp-2">{project.description || 'Chưa có mô tả.'}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
