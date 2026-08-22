'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export type AutomationBrowser = 'chromium' | 'firefox' | 'edge';
export type AuthMode = 'none' | 'cookie' | 'login';
export type ExecutionMode = 'serverless' | 'self_hosted';

export type ProjectEnvironment = {
  id: string;
  project_id: string;
  name: string;
  browser: AutomationBrowser;
  target_url: string;
  auth_mode: AuthMode;
  execution_mode: ExecutionMode;
  created_at: string;
};

/** List/create/delete for a project's saved (non-secret) automation environments. */
export function useEnvironments(projectId: string) {
  const { t } = useLanguage();
  const e = t.batchAutomation.environments;

  const [environments, setEnvironments] = useState<ProjectEnvironment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [browser, setBrowser] = useState<AutomationBrowser>('chromium');
  const [targetUrl, setTargetUrl] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('serverless');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Whether THIS deployment can run self-hosted "Full run" automation at all (see
  // GET /api/automation/runtime-info) — used to disable the option in the form
  // rather than let someone pick it and find out only on submit that the server
  // rejects it (assertExecutionModeAllowed in models/validators/playwright.ts).
  const [selfHostedAvailable, setSelfHostedAvailable] = useState(false);

  useEffect(() => {
    fetch('/api/automation/runtime-info')
      .then((res) => res.json())
      .then((json) => setSelfHostedAvailable(Boolean(json?.data?.self_hosted_available)))
      .catch(() => setSelfHostedAvailable(false));
  }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/projects/${projectId}/environments`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? e.loadFailed);
      setEnvironments(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : e.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function resetForm() {
    setName('');
    setBrowser('chromium');
    setTargetUrl('');
    setAuthMode('none');
    setExecutionMode('serverless');
    setSaveError('');
  }

  async function createEnvironment(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/projects/${projectId}/environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, browser, target_url: targetUrl, auth_mode: authMode, execution_mode: executionMode }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? e.createFailed);
      resetForm();
      setShowCreate(false);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : e.createFailed);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEnvironment(id: string) {
    setDeletingId(id);
    const previous = environments;
    setEnvironments((cur) => cur.filter((env) => env.id !== id));
    try {
      const res = await fetch(`/api/projects/${projectId}/environments?id=${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? e.deleteFailed);
    } catch (err) {
      setEnvironments(previous);
      setError(err instanceof Error ? err.message : e.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  }

  return {
    t, projectId,
    environments, loading, error, reload: load,
    showCreate, setShowCreate,
    name, setName, browser, setBrowser, targetUrl, setTargetUrl, authMode, setAuthMode,
    executionMode, setExecutionMode, selfHostedAvailable,
    saving, saveError, createEnvironment,
    deletingId, deleteEnvironment,
  };
}

export type EnvironmentsState = ReturnType<typeof useEnvironments>;
