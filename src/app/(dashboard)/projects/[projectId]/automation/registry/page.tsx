'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Boxes, ChevronDown, ChevronRight, GitMerge, AlertTriangle, Check, Globe } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { usePageObjectRegistry, type ConflictResolution, type RegistryConflict } from '@/hooks/automation/use-page-object-registry';
import { BackLink } from '@/views/layout/back-link';
import { highlight } from '@/views/test-case/automation/code-viewer';

type ActiveTab = 'entries' | 'conflicts';

export default function PageObjectRegistryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const reg = usePageObjectRegistry(projectId);
  const { t } = reg;
  const r = t.batchAutomation.registry;
  const locale = useLanguage().locale;
  const [tab, setTab] = useState<ActiveTab>('entries');

  const pendingCount = reg.conflicts.length;

  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/projects/${projectId}`} label={r.backToProject} />
        <p className="text-eyebrow mt-4">{r.eyebrow}</p>
        <h1 className="text-h1 mt-2">{r.title}</h1>
        <p className="text-body mt-2 max-w-2xl">{r.subtitle}</p>
        <Link
          href={`/projects/${projectId}/automation/environments`}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
        >
          <Globe className="h-3.5 w-3.5" />
          {t.batchAutomation.environments.title}
        </Link>
      </div>

      <div className="flex gap-2 border-b border-ink-100">
        <button
          onClick={() => setTab('entries')}
          className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
            tab === 'entries' ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-700'
          }`}
        >
          <Boxes className="h-4 w-4" />
          {r.tabEntries}
          <span className="badge-neutral">{reg.entries.length}</span>
        </button>
        <button
          onClick={() => setTab('conflicts')}
          className={`flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
            tab === 'conflicts' ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-700'
          }`}
        >
          <GitMerge className="h-4 w-4" />
          {r.tabConflicts}
          {pendingCount > 0 && <span className="badge-warning">{pendingCount}</span>}
        </button>
      </div>

      {tab === 'entries' ? <EntriesTab reg={reg} locale={locale} /> : <ConflictsTab reg={reg} locale={locale} />}
    </div>
  );
}

function EntriesTab({ reg, locale }: { reg: ReturnType<typeof usePageObjectRegistry>; locale: string }) {
  const r = reg.t.batchAutomation.registry;

  if (reg.entriesLoading) return <p className="text-body">…</p>;
  if (reg.entriesError) return <div className="alert-danger">{reg.entriesError}</div>;
  if (reg.entries.length === 0) {
    return (
      <div className="surface-card p-10 text-center">
        <Boxes className="mx-auto h-8 w-8 text-ink-300" />
        <p className="text-body mt-3 max-w-md mx-auto">{r.empty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reg.entries.map((entry) => {
        const isExpanded = reg.expandedId === entry.id;
        const detail = reg.detailById[entry.id];
        const isLoadingDetail = reg.detailLoadingId === entry.id;

        return (
          <div key={entry.id} className="surface-card overflow-hidden">
            <button
              onClick={() => reg.toggleExpand(entry.id)}
              className="flex w-full flex-wrap items-center justify-between gap-3 p-5 text-left hover:bg-ink-50/50"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? <ChevronDown className="h-4 w-4 text-ink-400" /> : <ChevronRight className="h-4 w-4 text-ink-400" />}
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-h3 font-mono">{entry.class_name}</h3>
                    {entry.pending_conflict_count > 0 && (
                      <span className="badge-warning">
                        <AlertTriangle className="h-3 w-3" />
                        {r.conflictBadge(entry.pending_conflict_count)}
                      </span>
                    )}
                  </div>
                  <p className="text-caption mt-1">
                    {entry.file_name}
                    {entry.page_label ? ` · ${entry.page_label}` : ''}
                    {entry.page_url_pattern ? ` · ${entry.page_url_pattern}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-caption">
                <span>{r.methodsCol}: {entry.method_signatures.length}</span>
                <span>{r.usedByCol}: {entry.used_by_test_case_count}</span>
                <span>{r.versionCol}: v{entry.version}</span>
                <span>{new Date(entry.updated_at).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}</span>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-ink-100 p-5">
                <p className="text-eyebrow mb-2">{r.methodHistory}</p>
                <ul className="mb-4 space-y-1">
                  {entry.method_signatures.map((m) => (
                    <li key={m.name} className="text-caption font-mono">
                      {m.name}({m.params}) — {r.addedAt} {new Date(m.added_at).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US')}
                    </li>
                  ))}
                </ul>

                {isLoadingDetail ? (
                  <p className="text-body">…</p>
                ) : detail ? (
                  <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-ink-900 p-4 text-xs leading-relaxed text-ink-100">
                    <code dangerouslySetInnerHTML={{ __html: highlight(detail.code) }} />
                  </pre>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConflictsTab({ reg, locale }: { reg: ReturnType<typeof usePageObjectRegistry>; locale: string }) {
  const r = reg.t.batchAutomation.registry;

  if (reg.conflictsLoading) return <p className="text-body">…</p>;
  if (reg.conflictsError) return <div className="alert-danger">{reg.conflictsError}</div>;
  if (reg.conflicts.length === 0) {
    return (
      <div className="surface-card p-10 text-center">
        <Check className="mx-auto h-8 w-8 text-success-500" />
        <p className="text-body mt-3">{r.conflictsEmpty}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {reg.resolveError && <div className="alert-danger">{reg.resolveError}</div>}
      {reg.conflicts.map((conflict) => (
        <ConflictCard key={conflict.id} conflict={conflict} reg={reg} locale={locale} />
      ))}
    </div>
  );
}

function ConflictCard({
  conflict,
  reg,
  locale,
}: {
  conflict: RegistryConflict;
  reg: ReturnType<typeof usePageObjectRegistry>;
  locale: string;
}) {
  const r = reg.t.batchAutomation.registry;
  const isResolving = reg.resolvingId === conflict.id;
  const [showManualEditor, setShowManualEditor] = useState(false);

  function extractMethodSnippet(fullFileCode: string): string {
    // Best-effort visual trim: show just the flagged method, not the whole file, so
    // the reviewer compares like-for-like. Falls back to the full file if the method
    // name can't be located textually (formatting edge case) rather than showing nothing.
    const idx = fullFileCode.indexOf(`${conflict.method_name}(`);
    if (idx === -1) return fullFileCode;
    const start = fullFileCode.lastIndexOf('\n', idx) + 1;
    let depth = 0;
    let end = fullFileCode.indexOf('{', idx);
    if (end === -1) return fullFileCode;
    depth = 1;
    let i = end + 1;
    while (i < fullFileCode.length && depth > 0) {
      if (fullFileCode[i] === '{') depth++;
      else if (fullFileCode[i] === '}') depth--;
      i++;
    }
    return fullFileCode.slice(start, i);
  }

  async function handleResolve(resolution: ConflictResolution) {
    await reg.resolveConflict(conflict.id, resolution);
  }

  return (
    <div className="surface-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-warning-600" />
        <h3 className="text-h3 font-mono">
          {conflict.class_name}.{conflict.method_name}()
        </h3>
        <span className="text-caption ml-auto">{new Date(conflict.created_at).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}</span>
      </div>
      <p className="text-body mb-4">{conflict.reason}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-eyebrow mb-2">{r.conflictExistingLabel}</p>
          <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-ink-900 p-3 text-xs leading-relaxed text-ink-100">
            <code dangerouslySetInnerHTML={{ __html: highlight(extractMethodSnippet(conflict.existing_code)) }} />
          </pre>
        </div>
        <div>
          <p className="text-eyebrow mb-2">{r.conflictProposedLabel}</p>
          <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-ink-900 p-3 text-xs leading-relaxed text-ink-100">
            <code dangerouslySetInnerHTML={{ __html: highlight(extractMethodSnippet(conflict.proposed_code)) }} />
          </pre>
        </div>
      </div>

      {showManualEditor && (
        <textarea
          value={reg.manualCodeByConflict[conflict.id] ?? ''}
          onChange={(e) => reg.setManualCode(conflict.id, e.target.value)}
          placeholder={r.manualPlaceholder}
          rows={6}
          className="field-input mt-4 font-mono text-xs"
        />
      )}

      <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
        <button type="button" disabled={isResolving} onClick={() => handleResolve('keep_existing')} className="btn-secondary btn-sm">
          {r.keepExisting}
        </button>
        <button type="button" disabled={isResolving} onClick={() => handleResolve('use_proposed')} className="btn-secondary btn-sm">
          {r.useProposed}
        </button>
        {!showManualEditor ? (
          <button type="button" disabled={isResolving} onClick={() => setShowManualEditor(true)} className="btn-ghost btn-sm">
            {r.editManually}
          </button>
        ) : (
          <button type="button" disabled={isResolving} onClick={() => handleResolve('manual')} className="btn-primary btn-sm">
            {isResolving ? r.resolving : r.resolveButton}
          </button>
        )}
      </div>
    </div>
  );
}
