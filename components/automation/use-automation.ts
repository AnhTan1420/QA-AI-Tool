'use client';

import { useCallback, useEffect, useState } from 'react';
import { postJson } from '@/lib/api/client';
import type {
  AutomationRun,
  AutomationScript,
  BrowserProfile,
  DiscoveryCase,
  GenerateConfig,
  GenerateResult,
} from './types';

export function useAutomation(testCaseId: string, projectId: string, setId: string) {
  const [scripts, setScripts] = useState<AutomationScript[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [activeRun, setActiveRun] = useState<AutomationRun | null>(null);
  const [generateResult, setGenerateResult] = useState<GenerateResult | null>(null);
  const [discoveryResults, setDiscoveryResults] = useState<DiscoveryCase[]>([]);
  const [error, setError] = useState<string | null>(null);

  const primaryScript = scripts[0] ?? null;

  const fetchScripts = useCallback(async () => {
    const res = await fetch(`/api/automation/scripts?test_case_id=${testCaseId}`);
    const json = await res.json();
    if (json.success) setScripts(json.data);
  }, [testCaseId]);

  const fetchRuns = useCallback(async (scriptId: string) => {
    const res = await fetch(`/api/automation/runs?script_id=${scriptId}&limit=5`);
    const json = await res.json();
    if (json.success) setRuns(json.data.runs);
  }, []);

  const fetchProfiles = useCallback(async () => {
    const res = await fetch(`/api/automation/profiles?project_id=${projectId}`);
    const json = await res.json();
    if (json.success) setProfiles(json.data);
  }, [projectId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchScripts(), fetchProfiles()]);
      setLoading(false);
    })();
  }, [fetchScripts, fetchProfiles]);

  useEffect(() => {
    if (primaryScript) fetchRuns(primaryScript.id);
  }, [primaryScript, fetchRuns]);

  const generateCode = async (config: GenerateConfig) => {
    setGenerating(true);
    setError(null);
    try {
      const data = await postJson<GenerateResult>(
        '/api/ai/automation/generate',
        {
          test_case_id: testCaseId,
          environment: config.environment,
          target_url: config.target_url,
          cookie_token: config.cookie_token,
          credentials: config.useCredentials ? config.credentials : undefined,
          browser_profile_id: config.browser_profile_id,
        },
        () => 'Generation failed',
      );
      setGenerateResult(data);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
      throw e;
    } finally {
      setGenerating(false);
    }
  };

  const saveScript = async (config: GenerateConfig, code: string) => {
    const res = await fetch('/api/automation/scripts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        test_case_id: testCaseId,
        test_case_set_id: setId,
        environment: config.environment,
        target_url: config.target_url,
        cookie_token: config.cookie_token,
        credentials: config.useCredentials ? config.credentials : undefined,
        browser_profile_id: config.browser_profile_id,
        generated_code: code,
        status: 'generated',
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    await fetchScripts();
    setGenerateResult(null);
    return json.data;
  };

  const runScript = async (scriptId: string, browsers?: ('chromium' | 'firefox' | 'webkit')[]) => {
    setRunning(true);
    setError(null);
    setActiveRun(null);
    try {
      const data = await postJson<{ run: AutomationRun }>(
        '/api/automation/runs',
        { script_id: scriptId, browsers },
        () => 'Run failed',
      );
      setActiveRun(data.run);
      await fetchRuns(scriptId);
      return data.run;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed');
      throw e;
    } finally {
      setRunning(false);
    }
  };

  const updateScriptCode = async (scriptId: string, code: string) => {
    const res = await fetch(`/api/automation/scripts/${scriptId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generated_code: code, change_summary: 'Manual edit from UI' }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    await fetchScripts();
  };

  const discoverElements = async (url: string) => {
    setDiscovering(true);
    setError(null);
    try {
      const data = await postJson<{ suggested_test_cases: DiscoveryCase[] }>(
        '/api/ai/automation/discover',
        { target_url: url, project_id: projectId },
        () => 'Discovery failed',
      );
      setDiscoveryResults(data.suggested_test_cases ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Discovery failed');
    } finally {
      setDiscovering(false);
    }
  };

  const runNaturalTask = async (task: string, url: string) => {
    setRunning(true);
    setError(null);
    try {
      const data = await postJson<{ run: AutomationRun; test_case_id: string }>(
        '/api/ai/automation/natural-run',
        { task, target_url: url, project_id: projectId },
        () => 'Natural run failed',
      );
      setActiveRun(data.run);
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Natural run failed');
      throw e;
    } finally {
      setRunning(false);
    }
  };

  const bulkSaveDiscovery = async (cases: DiscoveryCase[]) => {
    for (const c of cases) {
      await fetch('/api/test-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          code: `TC-DISC-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.random().toString(36).slice(2, 4)}`,
          title: c.title,
          category: c.category === 'ui' ? 'ui_ux' : c.category,
          priority: c.priority === 'high' ? 'Critical' : c.priority === 'medium' ? 'Major' : 'Normal',
          steps: c.steps.map((action, i) => ({
            step_number: i + 1,
            action,
            expected_result: i === c.steps.length - 1 ? c.expected_result : 'Step completes',
          })),
          expected_result: c.expected_result,
          status: 'draft',
        }),
      });
    }
    setDiscoveryResults([]);
  };

  return {
    scripts,
    primaryScript,
    runs,
    profiles,
    loading,
    generating,
    running,
    discovering,
    activeRun,
    generateResult,
    discoveryResults,
    error,
    generateCode,
    saveScript,
    runScript,
    updateScriptCode,
    discoverElements,
    runNaturalTask,
    bulkSaveDiscovery,
    setGenerateResult,
    fetchScripts,
  };
}

export type AutomationState = ReturnType<typeof useAutomation>;
