'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, X, FlaskConical, ArrowRight, FolderKanban, Trash2 } from 'lucide-react';

type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
};

type ApiPayload<T> = { success: boolean; error?: string; data?: T };

/**
 * Doc response an toan: server co the tra ve HTML (trang loi 404/500 cua Vercel,
 * redirect login, v.v.) thay vi JSON that su - luc do response.json() truc tiep se
 * nem loi kho hieu ("JSON.parse: unexpected character..."). Doc dang text truoc,
 * roi thu parse, neu that bai thi tra ve thong bao loi ro rang kem HTTP status.
 */
async function parseApiResponse<T>(response: Response): Promise<ApiPayload<T>> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : { success: false, error: `Server không trả về dữ liệu (HTTP ${response.status}).` };
  } catch {
    return {
      success: false,
      error: `Phản hồi không hợp lệ từ server (HTTP ${response.status}). Có thể route chưa được deploy hoặc phiên đăng nhập đã hết hạn.`,
    };
  }
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function loadProjects() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/projects');
      const payload = await parseApiResponse<Project[]>(response);
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
      const payload = await parseApiResponse<Project>(response);
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

  async function handleDelete(projectId: string) {
    setDeletingId(projectId);
    setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      const payload = await parseApiResponse<{ id: string }>(response);
      if (!response.ok || !payload.success) throw new Error(payload.error ?? 'Không thể xóa project');
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể xóa project');
    } finally {
      setDeletingId(null);
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
        {projects.map((project) => {
          const isConfirming = confirmId === project.id;
          const isDeleting = deletingId === project.id;

          return (
            <div key={project.id} className="group relative">
              <Link href={`/projects/${project.id}`} className="surface-card-interactive block p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <FolderKanban className="h-5 w-5" strokeWidth={2.25} />
                </span>
                <h2 className="text-h3 mt-4 pr-8">{project.name}</h2>
                <p className="text-body mt-2 line-clamp-2">{project.description || 'Chưa có mô tả.'}</p>
              </Link>

              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setConfirmId(project.id);
                }}
                aria-label={`Xóa project ${project.name}`}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 opacity-0 transition-opacity duration-150 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2.25} />
              </button>

              {isConfirming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] bg-white/97 p-6 text-center shadow-[var(--shadow-soft-lg)] backdrop-blur-sm">
                  <p className="text-sm font-semibold text-ink-900">Xóa &quot;{project.name}&quot;?</p>
                  <p className="text-xs leading-relaxed text-ink-500">
                    Toàn bộ test case và thành viên của project sẽ bị xóa vĩnh viễn. Không thể hoàn tác.
                  </p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={() => setConfirmId(null)} className="btn-secondary" disabled={isDeleting}>
                      Hủy
                    </button>
                    <button type="button" onClick={() => handleDelete(project.id)} className="btn-danger" disabled={isDeleting}>
                      {isDeleting ? 'Đang xóa...' : 'Xóa project'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
