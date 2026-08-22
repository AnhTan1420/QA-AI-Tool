'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export type MethodSignature = { name: string; params: string; added_by_test_case_id: string | null; added_at: string };

export type RegistryEntrySummary = {
  id: string;
  class_name: string;
  file_name: string;
  page_label: string | null;
  page_url_pattern: string | null;
  method_signatures: MethodSignature[];
  version: number;
  updated_at: string;
  created_at: string;
  used_by_test_case_count: number;
  pending_conflict_count: number;
};

export type RegistryEntryDetail = RegistryEntrySummary & {
  code: string;
  used_by: { script_id: string; page_object_version_used: number; test_case_id: string | null }[];
};

export type RegistryConflict = {
  id: string;
  page_object_id: string;
  class_name: string | null;
  file_name: string | null;
  method_name: string;
  reason: string;
  proposed_code: string;
  existing_code: string;
  source_test_case_id: string | null;
  source_script_id: string | null;
  status: string;
  created_at: string;
};

export type ConflictResolution = 'keep_existing' | 'use_proposed' | 'manual';

/** List + drill-down for a project's Page Object Registry, and the pending-conflict
 * review queue (Automation Agent Rebuild §4.1/§7). Two independent loads (entries,
 * conflicts) since the UI tabs between them and there's no reason to block one on
 * the other. */
export function usePageObjectRegistry(projectId: string) {
  const { t } = useLanguage();
  const r = t.batchAutomation.registry;

  const [entries, setEntries] = useState<RegistryEntrySummary[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState('');

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, RegistryEntryDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const [conflicts, setConflicts] = useState<RegistryConflict[]>([]);
  const [conflictsLoading, setConflictsLoading] = useState(true);
  const [conflictsError, setConflictsError] = useState('');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState('');
  const [manualCodeByConflict, setManualCodeByConflict] = useState<Record<string, string>>({});

  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    setEntriesError('');
    try {
      const res = await fetch(`/api/projects/${projectId}/registry`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? r.loadFailed);
      setEntries(json.data ?? []);
    } catch (err) {
      setEntriesError(err instanceof Error ? err.message : r.loadFailed);
    } finally {
      setEntriesLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const loadConflicts = useCallback(async () => {
    setConflictsLoading(true);
    setConflictsError('');
    try {
      const res = await fetch(`/api/projects/${projectId}/registry/conflicts`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? r.conflictsLoadFailed);
      setConflicts(json.data ?? []);
    } catch (err) {
      setConflictsError(err instanceof Error ? err.message : r.conflictsLoadFailed);
    } finally {
      setConflictsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    loadEntries();
    loadConflicts();
  }, [loadEntries, loadConflicts]);

  async function toggleExpand(entryId: string) {
    if (expandedId === entryId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(entryId);
    if (detailById[entryId]) return; // already fetched, no need to refetch
    setDetailLoadingId(entryId);
    try {
      const res = await fetch(`/api/projects/${projectId}/registry/${entryId}`);
      const json = await res.json();
      if (res.ok && json.success) {
        setDetailById((cur) => ({ ...cur, [entryId]: json.data }));
      }
    } finally {
      setDetailLoadingId(null);
    }
  }

  function setManualCode(conflictId: string, code: string) {
    setManualCodeByConflict((cur) => ({ ...cur, [conflictId]: code }));
  }

  async function resolveConflict(conflictId: string, resolution: ConflictResolution) {
    setResolvingId(conflictId);
    setResolveError('');
    try {
      const body: Record<string, string> = { resolution };
      if (resolution === 'manual') body.manual_method_code = manualCodeByConflict[conflictId] ?? '';
      const res = await fetch(`/api/projects/${projectId}/registry/conflicts/${conflictId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? r.resolveFailed);
      setConflicts((cur) => cur.filter((c) => c.id !== conflictId));
      // The resolved entry's code/version changed server-side — drop any cached
      // detail so the next expand re-fetches fresh content instead of showing stale code.
      setDetailById((cur) => {
        const conflict = conflicts.find((c) => c.id === conflictId);
        if (!conflict) return cur;
        const { [conflict.page_object_id]: _drop, ...rest } = cur;
        return rest;
      });
      await loadEntries(); // pending_conflict_count / version on the list needs refreshing too
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : r.resolveFailed);
    } finally {
      setResolvingId(null);
    }
  }

  return {
    t,
    entries, entriesLoading, entriesError, reloadEntries: loadEntries,
    expandedId, toggleExpand, detailById, detailLoadingId,
    conflicts, conflictsLoading, conflictsError, reloadConflicts: loadConflicts,
    resolvingId, resolveError, resolveConflict,
    manualCodeByConflict, setManualCode,
  };
}

export type PageObjectRegistryState = ReturnType<typeof usePageObjectRegistry>;
