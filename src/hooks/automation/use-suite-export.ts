'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export type ExportScopeKind = 'project' | 'test_case_set';

export type TestCaseSetOption = { id: string; title: string; test_case_count: number };

export type ExportAuditRow = {
  id: string;
  target: string;
  commit_sha: string | null;
  pr_url: string | null;
  exported_at: string;
  script_versions: { test_case_id: string }[];
};

/** Suite Export UI state (Automation Agent Rebuild §4.4/Phase 5). */
export function useSuiteExport(projectId: string) {
  const { t } = useLanguage();
  const e = t.batchAutomation.export;

  const [sets, setSets] = useState<TestCaseSetOption[]>([]);
  const [setsLoading, setSetsLoading] = useState(true);
  const [setsError, setSetsError] = useState('');

  const [scopeKind, setScopeKind] = useState<ExportScopeKind>('project');
  const [selectedSetId, setSelectedSetId] = useState('');

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [downloadSummary, setDownloadSummary] = useState('');

  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [token, setToken] = useState('');
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState('');
  const [pushResult, setPushResult] = useState<{ pr_url: string } | null>(null);

  const [history, setHistory] = useState<ExportAuditRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    setSetsLoading(true);
    fetch(`/api/projects/${projectId}/test-case-sets`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? e.loadSetsFailed);
        setSets(json.data ?? []);
      })
      .catch((err) => setSetsError(err instanceof Error ? err.message : e.loadSetsFailed))
      .finally(() => setSetsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    setHistoryLoading(true);
    fetch(`/api/projects/${projectId}/exports`)
      .then((res) => res.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error ?? e.auditLoadFailed);
        setHistory(json.data ?? []);
      })
      .catch((err) => setHistoryError(err instanceof Error ? err.message : e.auditLoadFailed))
      .finally(() => setHistoryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function buildScope() {
    return scopeKind === 'project' ? { kind: 'project' as const, projectId } : { kind: 'test_case_set' as const, projectId, setId: selectedSetId };
  }

  async function downloadZip() {
    setDownloading(true);
    setDownloadError('');
    setDownloadSummary('');
    try {
      const res = await fetch('/api/automation/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: buildScope() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error ?? e.downloadFailed);
      }
      const included = Number(res.headers.get('X-Export-Included-Count') ?? 0);
      const skipped = Number(res.headers.get('X-Export-Skipped-Count') ?? 0);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qajd-automation-suite.zip';
      a.click();
      URL.revokeObjectURL(url);
      setDownloadSummary(e.includedSummary(included, skipped));
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : e.downloadFailed);
    } finally {
      setDownloading(false);
    }
  }

  async function pushToGitHub(event: React.FormEvent) {
    event.preventDefault();
    setPushing(true);
    setPushError('');
    setPushResult(null);
    try {
      const res = await fetch('/api/automation/export/github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: buildScope(), owner, repo, target_branch_base: targetBranch || undefined, token }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? e.pushFailed);
      setPushResult({ pr_url: json.data.pr_url });
      setToken(''); // never keep it around longer than the single request that needed it
    } catch (err) {
      setPushError(err instanceof Error ? err.message : e.pushFailed);
    } finally {
      setPushing(false);
    }
  }

  return {
    t,
    sets, setsLoading, setsError,
    scopeKind, setScopeKind, selectedSetId, setSelectedSetId,
    downloading, downloadError, downloadSummary, downloadZip,
    owner, setOwner, repo, setRepo, targetBranch, setTargetBranch, token, setToken,
    pushing, pushError, pushResult, pushToGitHub,
    history, historyLoading, historyError,
  };
}

export type SuiteExportState = ReturnType<typeof useSuiteExport>;
