'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Plus, X, FlaskConical, ArrowRight, FolderKanban, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { getDictionary } from '@/lib/i18n/dictionaries';

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
async function parseApiResponse<T>(response: Response, t: ReturnType<typeof getDictionary>): Promise<ApiPayload<T>> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : { success: false, error: t.projects.errors.serverNoData(response.status) };
  } catch {
    return {
      success: false,
      error: t.projects.errors.invalidResponse(response.status),
    };
  }
}

export default function ProjectsPage() {
  const { t } = useLanguage();
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
      const payload = await parseApiResponse<Project[]>(response, t);
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t.projects.errors.loadFailed);
      setProjects(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.projects.errors.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const payload = await parseApiResponse<Project>(response, t);
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t.projects.errors.createFailed);
      setName('');
      setDescription('');
      setShowForm(false);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.projects.errors.createFailed);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDelete(projectId: string) {
    setDeletingId(projectId);
    setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      const payload = await parseApiResponse<{ id: string }>(response, t);
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t.projects.errors.deleteFailed);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setConfirmId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.projects.errors.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">{t.projects.eyebrow}</p>
          <h1 className="text-h1 mt-2">{t.projects.title}</h1>
          <p className="text-body mt-2 max-w-2xl">{t.projects.subtitle}</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className={showForm ? 'btn-secondary' : 'btn-primary'}>
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? t.projects.closeButton : t.projects.createButton}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createProject} className="surface-card space-y-5 p-6">
          <label className="block">
            <span className="field-label">{t.projects.formNameLabel}</span>
            <input required value={name} onChange={(e) => setName(e.target.value)} className="field-input" placeholder={t.projects.formNamePlaceholder} />
          </label>
          <label className="block">
            <span className="field-label">{t.projects.formDescLabel}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="field-input" rows={2} />
          </label>
          <button type="submit" disabled={isCreating} className="btn-primary">
            {isCreating ? t.projects.formSubmitting : t.projects.formSubmit}
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
            <h2 className="text-h3">{t.projects.sandboxTitle}</h2>
            <p className="text-body mt-1">{t.projects.sandboxDesc}</p>
            <Link href="/projects/demo/generate" className="btn-secondary mt-4">
              {t.projects.tryGenerate}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {loading && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 p-10 text-center text-ink-500">
          {t.projects.loadingList}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 p-10 text-center text-ink-500">
          {t.projects.emptyList}
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
                <p className="text-body mt-2 line-clamp-2">{project.description || t.projects.noDescription}</p>
              </Link>

              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setConfirmId(project.id);
                }}
                aria-label={t.projects.deleteAria(project.name)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 opacity-0 transition-opacity duration-150 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" strokeWidth={2.25} />
              </button>

              {isConfirming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] bg-white/97 p-6 text-center shadow-[var(--shadow-soft-lg)] backdrop-blur-sm">
                  <p className="text-sm font-semibold text-ink-900">{t.projects.confirmDeleteTitle(project.name)}</p>
                  <p className="text-xs leading-relaxed text-ink-500">{t.projects.confirmDeleteBody}</p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={() => setConfirmId(null)} className="btn-secondary" disabled={isDeleting}>
                      {t.common.cancel}
                    </button>
                    <button type="button" onClick={() => handleDelete(project.id)} className="btn-danger" disabled={isDeleting}>
                      {isDeleting ? t.projects.deleting : t.projects.deleteButton}
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
