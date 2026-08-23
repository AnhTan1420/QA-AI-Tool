'use client';

import { use } from 'react';
import Link from 'next/link';
import { Download, Github, ExternalLink, GitPullRequest, History, Globe, Boxes } from 'lucide-react';
import { useSuiteExport } from '@/hooks/automation/use-suite-export';
import { BackLink } from '@/views/layout/back-link';

export default function SuiteExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const ex = useSuiteExport(projectId);
  const { t } = ex;
  const e = t.batchAutomation.export;

  const scopeReady = ex.scopeKind === 'project' || (ex.scopeKind === 'test_case_set' && ex.selectedSetId);

  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/projects/${projectId}`} label={e.backToProject} />
        <p className="text-eyebrow mt-4">{e.eyebrow}</p>
        <h1 className="text-h1 mt-2">{e.title}</h1>
        <p className="text-body mt-2 max-w-2xl">{e.subtitle}</p>
        <div className="mt-3 flex gap-4">
          <Link
            href={`/projects/${projectId}/automation/registry`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
          >
            <Boxes className="h-3.5 w-3.5" />
            {t.batchAutomation.registry.title}
          </Link>
          <Link
            href={`/projects/${projectId}/automation/environments`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
          >
            <Globe className="h-3.5 w-3.5" />
            {t.batchAutomation.environments.title}
          </Link>
        </div>
      </div>

      {/* Scope picker — shared by both the zip download and the GitHub push below */}
      <div className="surface-card p-5">
        <label className="field-label">{e.scopeLabel}</label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => ex.setScopeKind('project')}
            className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-semibold transition ${
              ex.scopeKind === 'project' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
            }`}
          >
            {e.scopeProject}
          </button>
          <button
            type="button"
            onClick={() => ex.setScopeKind('test_case_set')}
            className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-xs font-semibold transition ${
              ex.scopeKind === 'test_case_set' ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:bg-ink-50'
            }`}
          >
            {e.scopeSet}
          </button>
        </div>

        {ex.scopeKind === 'test_case_set' && (
          <div className="mt-3">
            {ex.setsLoading ? (
              <p className="text-caption">…</p>
            ) : ex.setsError ? (
              <p className="text-caption text-danger-600">{ex.setsError}</p>
            ) : (
              <select value={ex.selectedSetId} onChange={(ev) => ex.setSelectedSetId(ev.target.value)} className="field-input max-w-md">
                <option value="">{e.pickSetPlaceholder}</option>
                {ex.sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} — {e.setTestCaseCount(s.test_case_count)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Download .zip — always available, no external service needed */}
      <div className="surface-card p-5">
        <h2 className="text-h3">{e.downloadZipButton}</h2>
        {ex.downloadError && <div className="alert-danger mt-3">{ex.downloadError}</div>}
        {ex.downloadSummary && <div className="alert-success mt-3">{ex.downloadSummary}</div>}
        <button type="button" disabled={!scopeReady || ex.downloading} onClick={() => ex.downloadZip()} className="btn-primary mt-3">
          <Download className="h-4 w-4" />
          {ex.downloading ? e.downloading : e.downloadZipButton}
        </button>
      </div>

      {/* GitHub push (always opens a PR) */}
      <div className="surface-card p-5">
        <h2 className="text-h3 flex items-center gap-2">
          <Github className="h-4 w-4" />
          {e.githubSectionTitle}
        </h2>
        <p className="text-caption mt-2 italic">{e.githubSectionNote}</p>

        <form onSubmit={ex.pushToGitHub} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label">{e.githubOwnerLabel}</label>
            <input value={ex.owner} onChange={(ev) => ex.setOwner(ev.target.value)} required className="field-input" placeholder="my-org" />
          </div>
          <div>
            <label className="field-label">{e.githubRepoLabel}</label>
            <input value={ex.repo} onChange={(ev) => ex.setRepo(ev.target.value)} required className="field-input" placeholder="my-repo" />
          </div>
          <div>
            <label className="field-label">{e.githubBranchLabel}</label>
            <input value={ex.targetBranch} onChange={(ev) => ex.setTargetBranch(ev.target.value)} className="field-input" placeholder="main" />
          </div>
          <div>
            <label className="field-label">{e.githubTokenLabel}</label>
            <input
              type="password"
              value={ex.token}
              onChange={(ev) => ex.setToken(ev.target.value)}
              required
              className="field-input"
              placeholder={e.githubTokenPlaceholder}
              autoComplete="off"
            />
          </div>

          {ex.pushError && (
            <div className="alert-danger sm:col-span-2">{ex.pushError}</div>
          )}
          {ex.pushResult && (
            <div className="alert-success sm:col-span-2 flex items-center gap-2">
              <GitPullRequest className="h-4 w-4" />
              {e.pushSuccess}
              <a href={ex.pushResult.pr_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold underline">
                {e.viewPullRequest} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}

          <button
            type="submit"
            disabled={!scopeReady || ex.pushing || !ex.owner || !ex.repo || !ex.token}
            className="btn-secondary sm:col-span-2 w-fit"
          >
            <Github className="h-4 w-4" />
            {ex.pushing ? e.pushing : e.githubPushButton}
          </button>
        </form>
      </div>

      {/* Audit history */}
      <div className="surface-card p-5">
        <h2 className="text-h3 flex items-center gap-2">
          <History className="h-4 w-4" />
          {e.auditHistoryTitle}
        </h2>
        {ex.historyLoading ? (
          <p className="text-caption mt-3">…</p>
        ) : ex.historyError ? (
          <p className="text-caption mt-3 text-danger-600">{ex.historyError}</p>
        ) : ex.history.length === 0 ? (
          <p className="text-caption mt-3">{e.auditHistoryEmpty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ex.history.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-2 text-sm">
                <span className="badge-neutral">{row.target}</span>
                <span className="text-caption">{row.script_versions?.length ?? 0} test case</span>
                <span className="text-caption">{new Date(row.exported_at).toLocaleString()}</span>
                {row.pr_url && (
                  <a href={row.pr_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-brand-700 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" /> PR
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
