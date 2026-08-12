'use client';

import { use } from 'react';
import { Plus, X, Globe, Trash2 } from 'lucide-react';
import { useEnvironments } from '@/components/automation/use-environments';
import { BackLink } from '@/components/layout/back-link';

const AUTH_MODE_BADGE: Record<string, string> = {
  none: 'badge-neutral',
  cookie: 'badge-brand',
  login: 'badge-warning',
};

export default function EnvironmentsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const env = useEnvironments(projectId);
  const { t } = env;
  const e = t.batchAutomation.environments;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <BackLink href={`/projects/${projectId}`} label={e.backToProject} />
          <p className="text-eyebrow mt-4">{e.eyebrow}</p>
          <h1 className="text-h1 mt-2">{e.title}</h1>
          <p className="text-body mt-2 max-w-2xl">{e.subtitle}</p>
        </div>

        <button onClick={() => env.setShowCreate((v) => !v)} className={env.showCreate ? 'btn-secondary' : 'btn-primary'}>
          {env.showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {env.showCreate ? t.common.close : e.createButton}
        </button>
      </div>

      {env.error && <div className="alert-danger">{env.error}</div>}

      {env.showCreate && (
        <form onSubmit={env.createEnvironment} className="surface-card space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label">{e.nameLabel}</label>
              <input
                value={env.name}
                onChange={(ev) => env.setName(ev.target.value)}
                placeholder={e.namePlaceholder}
                required
                className="field-input"
              />
            </div>
            <div>
              <label className="field-label">{e.browserLabel}</label>
              <select value={env.browser} onChange={(ev) => env.setBrowser(ev.target.value as any)} className="field-input">
                <option value="chromium">{e.browserOptions.chromium}</option>
                <option value="firefox">{e.browserOptions.firefox}</option>
                <option value="edge">{e.browserOptions.edge}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="field-label">{e.targetUrlLabel}</label>
            <input
              type="url"
              value={env.targetUrl}
              onChange={(ev) => env.setTargetUrl(ev.target.value)}
              placeholder={e.targetUrlPlaceholder}
              required
              className="field-input"
            />
          </div>

          <div>
            <label className="field-label">{e.authModeLabel}</label>
            <div className="flex flex-wrap gap-2">
              {(['none', 'cookie', 'login'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => env.setAuthMode(mode)}
                  className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-semibold transition ${
                    env.authMode === mode
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-ink-200 text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  {mode === 'none' ? e.authNone : mode === 'cookie' ? e.authCookie : e.authLogin}
                </button>
              ))}
            </div>
            <p className="text-caption mt-2 italic">{e.authModeNote}</p>
          </div>

          {env.saveError && <p className="text-sm font-semibold text-danger-600">{env.saveError}</p>}

          <div className="flex items-center gap-3 border-t border-ink-100 pt-4">
            <button type="submit" disabled={env.saving} className="btn-primary">
              {env.saving ? e.saving : e.saveButton}
            </button>
            <button type="button" onClick={() => env.setShowCreate(false)} className="btn-ghost">
              {e.cancelButton}
            </button>
          </div>
        </form>
      )}

      {env.loading ? (
        <p className="text-body">{t.testCasesList.loading}</p>
      ) : env.environments.length === 0 ? (
        <div className="surface-card p-10 text-center">
          <Globe className="mx-auto h-8 w-8 text-ink-300" />
          <p className="text-body mt-3">{e.empty}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {env.environments.map((item) => (
            <div key={item.id} className="surface-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-h3">{item.name}</h3>
                  <p className="text-caption mt-1 break-all">{item.target_url}</p>
                </div>
                <button
                  onClick={() => {
                    if (confirm(e.deleteConfirm(item.name))) env.deleteEnvironment(item.id);
                  }}
                  disabled={env.deletingId === item.id}
                  className="btn-ghost !px-2 !py-2 text-danger-600 hover:bg-danger-50"
                  title={e.deleteButton}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="badge-neutral">{item.browser}</span>
                <span className={AUTH_MODE_BADGE[item.auth_mode]}>
                  {item.auth_mode === 'none' ? e.authNone : item.auth_mode === 'cookie' ? e.authCookie : e.authLogin}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
