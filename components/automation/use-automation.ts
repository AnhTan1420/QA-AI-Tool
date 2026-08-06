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
    try {
      const res = await fetch(`/api/automation/scripts?test_case_id=${testCaseId}`);
      const json = await res.json();
      if (json.success) setScripts(json.data);
    } catch (e) {
      console.error('fetchScripts error:', e);
    }
  }, [testCaseId]);

  const fetchRuns = useCallback(async (scriptId: string) => {
    try {
      const res = await fetch(`/api/automation/runs?script_id=${scriptId}&limit=5`);
      const json = await res.json();
      if (json.success) setRuns(json.data.runs);
    } catch (e) {
      console.error('fetchRuns error:', e);
    }
  }, []);

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/automation/profiles?project_id=${projectId}`);
      const json = await res.json();
      if (json.success) setProfiles(json.data);
    } catch (e) {
      console.error('fetchProfiles error:', e);
    }
  }, [projectId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      await Promise.all([fetchScripts(), fetchProfiles()]);
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [fetchScripts, fetchProfiles]);

  useEffect(() => {
    if (primaryScript) fetchRuns(primaryScript.id);
  }, [primaryScript, fetchRuns]);

  /** Step 1: Generate code from existing test case */
  const generateCode = async (config: GenerateConfig) => {
    setGenerating(true);
    setError(null);
    try {
      const data = await postJson<GenerateResult>('/api/ai/automation/generate', {
        test_case_id: testCaseId,
        environment: config.environment,
        target_url: config.target_url,
        cookie_token: config.cookie_token,
        credentials: config.useCredentials ? config.credentials : undefined,
        browser_profile_id: config.browser_profile_id,
      });
      setGenerateResult(data);
      return data;
    } catch (e: any) {
      const msg = e?.message || e?.error || 'Generation failed';
      setError(msg);
      throw e;
    } finally {
      setGenerating(false);
    }
  };

  /** Step 2: Save generated code as a script */
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
    if (!json.success) throw new Error(json.error || 'Save failed');
    await fetchScripts();
    setGenerateResult(null);
    return json.data;
  };

  /** Step 3: Execute a saved script */
  const runScript = async (scriptId: string, browsers?: ('chromium' | 'firefox' | 'webkit')[]) => {
    setRunning(true);
    setError(null);
    setActiveRun(null);
    try {
      const data = await postJson<{ run: AutomationRun }>('/api/automation/runs', {
        script_id: scriptId,
        browsers,
      });
      setActiveRun(data.run);
      await fetchRuns(scriptId);
      return data.run;
    } catch (e: any) {
      const msg = e?.message || e?.error || 'Run failed';
      setError(msg);
      throw e;
    } finally {
      setRunning(false);
    }
  };

  /** Update code manually (maintenance mode) */
  const updateScriptCode = async (scriptId: string, code: string) => {
    const res = await fetch(`/api/automation/scripts/${scriptId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generated_code: code, change_summary: 'Manual edit from UI' }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Update failed');
    await fetchScripts();
  };

  /** Discover test cases from a URL */
  const discoverElements = async (url: string, environment: 'chromium' | 'firefox' | 'webkit' = 'chromium') => {
    setDiscovering(true);
    setError(null);
    try {
      const data = await postJson<{ suggested_test_cases: DiscoveryCase[] }>(
        '/api/ai/automation/discover',
        { target_url: url, project_id: projectId, environment }
      );
      setDiscoveryResults(data.suggested_test_cases ?? []);
      return data.suggested_test_cases ?? [];
    } catch (e: any) {
      const msg = e?.message || e?.error || 'Discovery failed';
      setError(msg);
      throw e;
    } finally {
      setDiscovering(false);
    }
  };

  /** Natural language task → generate code preview (like generateCode but from text) */
  const runNaturalTask = async (
    task: string,
    url: string,
    environment: 'chromium' | 'firefox' | 'webkit' = 'chromium'
  ) => {
    setGenerating(true); // reuse generating spinner
    setError(null);
    try {
      const data = await postJson<{
        plan: any[];
        generated_code: string;
        detected_elements: string[];
        estimated_duration_ms: number;
        requires_auth: boolean;
        test_case_title: string;
        test_case_id: string | null;
      }>('/api/ai/automation/natural-run', {
        task,
        target_url: url,
        environment,
        project_id: projectId,
      });

      // Reuse generateResult state so the same Code Preview UI can display it
      setGenerateResult({
        generated_code: data.generated_code,
        detected_elements: data.detected_elements,
        estimated_duration_ms: data.estimated_duration_ms,
        requires_auth: data.requires_auth,
      });

      return data;
    } catch (e: any) {
      const msg = e?.message || e?.error || 'Natural run failed';
      setError(msg);
      throw e;
    } finally {
      setGenerating(false);
    }
  };

  /** Save discovered cases as draft test cases */
  const bulkSaveDiscovery = async (cases: DiscoveryCase[]) => {
    const results = await Promise.all(
      cases.map((c) =>
        fetch('/api/test-cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            test_case_set_id: setId,
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
        }).then((r) => r.json())
      )
    );

    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      console.warn('Some discovery cases failed to save:', failed);
    }

    setDiscoveryResults([]);
    await fetchScripts(); // refresh if any linked scripts
    return results;
  };

  return {
    // State
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

    // Actions
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