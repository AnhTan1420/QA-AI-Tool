'use client';

import { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { parseJsonResponse } from '@/lib/utils/fetch-json';
import type { ProjectEnvironment } from '@/components/automation/use-environments';

export type AutomationBrowser = 'chromium' | 'firefox' | 'edge';
export type AuthMode = 'none' | 'cookie' | 'login';

export type InspectedElement = {
  role: string;
  accessible_name: string;
  tag: string;
  selector: string;
  selector_strategy: string;
  is_visible: boolean;
};

export type PageObject = {
  class_name: string;
  file_name: string;
  page_label?: string;
  page_url?: string;
  code: string;
};

export type PlaywrightScript = {
  script_id: string | null;
  page_objects: PageObject[];
  code: string;
  imports_used: string[];
  selectors_used: string[];
  warnings: string[];
};

export type RunResult = {
  run_id: string;
  status: 'passed' | 'failed' | 'error';
  duration_ms: number;
  screenshot_url: string | null;
  failure_details: { error_message: string; selector?: string } | null;
};

export type InspectionStepAction = 'click' | 'fill' | 'press_enter' | 'goto';

export type InspectionStepDraft = {
  id: string;
  label: string;
  action: InspectionStepAction;
  selector: string;
  value: string;
  url: string;
};

const MAX_INSPECTION_STEPS = 10;

function newStepDraft(): InspectionStepDraft {
  return {
    id: Math.random().toString(36).slice(2),
    label: '',
    action: 'click',
    selector: '',
    value: '',
    url: '',
  };
}

type TestCaseForCodegen = {
  title: string;
  preconditions: string[];
  steps: { step_number: number; action: string; expected_result: string }[];
  expected_result: string;
};

export function useAutomation(testCaseId: string, testCase: TestCaseForCodegen, projectId?: string) {
  const { locale } = useLanguage();

  const [browser, setBrowser] = useState<AutomationBrowser>('chromium');
  const [targetUrl, setTargetUrl] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [cookieToken, setCookieToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [savedEnvironments, setSavedEnvironments] = useState<ProjectEnvironment[]>([]);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('');

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/environments`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success) setSavedEnvironments(json.data ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  const [scriptLoaded, setScriptLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/test-cases/${testCaseId}/automation/scripts`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.success || !json.data?.length) {
          setScriptLoaded(true);
          return;
        }
        const latest = json.data[0];
        setScript({
          script_id: latest.id,
          page_objects: latest.page_objects ?? [],
          code: latest.code,
          imports_used: latest.imports_used ?? [],
          selectors_used: latest.selectors_used ?? [],
          warnings: latest.warnings ?? [],
        });
        setScriptLoaded(true);
      })
      .catch(() => { setScriptLoaded(true); });
    return () => { cancelled = true; };
  }, [testCaseId]);

  function applySavedEnvironment(id: string) {
    setSelectedEnvironmentId(id);
    const env = savedEnvironments.find((e) => e.id === id);
    if (!env) return;
    setBrowser(env.browser);
    setTargetUrl(env.target_url);
    setAuthMode(env.auth_mode);
    setCookieToken('');
    setUsername('');
    setPassword('');
  }

  const [crawlEnabled, setCrawlEnabled] = useState(false);
  const [crawlMaxPages, setCrawlMaxPages] = useState(5);

  const [inspectionSteps, setInspectionSteps] = useState<InspectionStepDraft[]>([]);

  function addInspectionStep() {
    setInspectionSteps((steps) => (steps.length >= MAX_INSPECTION_STEPS ? steps : [...steps, newStepDraft()]));
  }
  function updateInspectionStep(id: string, patch: Partial<InspectionStepDraft>) {
    setInspectionSteps((steps) => steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function removeInspectionStep(id: string) {
    setInspectionSteps((steps) => steps.filter((s) => s.id !== id));
  }
  function moveInspectionStep(id: string, direction: -1 | 1) {
    setInspectionSteps((steps) => {
      const idx = steps.findIndex((s) => s.id === id);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= steps.length) return steps;
      const next = [...steps];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }

  function buildInspectionStepsPayload() {
    return inspectionSteps
      .filter((s) => s.label.trim())
      .map((s) => ({
        label: s.label.trim(),
        action: s.action,
        selector: s.selector.trim() || undefined,
        value: s.action === 'fill' ? s.value : undefined,
        url: s.action === 'goto' ? s.url.trim() || undefined : undefined,
      }));
  }

  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState('');
  const [elementMap, setElementMap] = useState<InspectedElement[]>([]);
  const [pageTitle, setPageTitle] = useState('');
  const [inspectWarnings, setInspectWarnings] = useState<string[]>([]);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [script, setScript] = useState<PlaywrightScript | null>(null);

  const [isEditingScript, setIsEditingScript] = useState(false);
  const [editedCode, setEditedCode] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveEditError, setSaveEditError] = useState('');

  function startEditingScript() {
    if (!script) return;
    setEditedCode(script.code);
    setIsEditingScript(true);
  }

  function cancelEditingScript() {
    setIsEditingScript(false);
    setEditedCode('');
    setSaveEditError('');
  }

  async function saveEditedScript() {
    if (!script || !editedCode.trim()) return;
    setSavingEdit(true);
    setSaveEditError('');
    try {
      const res = await fetch(`/api/test-cases/${testCaseId}/automation/scripts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: editedCode,
          page_objects: script.page_objects,
          imports_used: script.imports_used,
          selectors_used: script.selectors_used,
          warnings: [...script.warnings, 'Manually edited by user.'],
        }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Save failed');
      setScript({ ...script, code: editedCode, script_id: json.data.id });
      setIsEditingScript(false);
      setEditedCode('');
      bumpHistoryRefresh();
    } catch (err) {
      setSaveEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteScript() {
    if (!script?.script_id) return;
    const confirmed = window.confirm('Xóa script này? Lịch sử chạy vẫn được giữ lại.');
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/test-cases/${testCaseId}/automation/scripts/${script.script_id}`, {
        method: 'DELETE',
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Delete failed');
    } catch (err) {
      console.error('Failed to delete script:', err);
    }

    setScript(null);
    setIsEditingScript(false);
    setEditedCode('');
    bumpHistoryRefresh();
  }

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const bumpHistoryRefresh = useCallback(() => setHistoryRefreshKey((k) => k + 1), []);

  function buildEnvironmentPayload() {
    return {
      browser,
      target_url: targetUrl,
      cookie_token: authMode === 'cookie' ? cookieToken : undefined,
      login: authMode === 'login' ? { username, password } : undefined,
    };
  }

  async function inspect() {
    setInspecting(true);
    setInspectError('');
    setInspectWarnings([]);
    try {
      const res = await fetch('/api/automation/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment: buildEnvironmentPayload(),
          inspection_steps: buildInspectionStepsPayload(),
          crawl: crawlEnabled ? { enabled: true, max_pages: crawlMaxPages } : undefined,
        }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Inspect failed');
      setElementMap(json.data.element_map);
      setPageTitle(json.data.page_title);
      setInspectWarnings(json.data.warnings ?? []);
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : 'Inspect failed');
    } finally {
      setInspecting(false);
    }
  }

  async function generateCode() {
    setGenerating(true);
    setGenerateError('');
    try {
      const res = await fetch('/api/ai/playwright', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_case_id: testCaseId,
          test_case: testCase,
          element_map: elementMap,
          environment: { browser, target_url: targetUrl, auth_mode: authMode },
          language: locale === 'vi' ? 'Tiếng Việt' : 'English',
        }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Generate failed');
      setScript(json.data);
      bumpHistoryRefresh();
      return json.data as PlaywrightScript;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generate failed';
      setGenerateError(msg);
      throw err;
    } finally {
      setGenerating(false);
    }
  }

  async function runTest() {
    if (!script) return;
    setRunning(true);
    setRunError('');
    try {
      const res = await fetch('/api/automation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_case_id: testCaseId,
          script_id: script.script_id ?? undefined,
          code: script.script_id ? undefined : script.code,
          page_objects: script.script_id ? undefined : script.page_objects,
          environment: buildEnvironmentPayload(),
        }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Run failed');
      setRunResult(json.data);
      bumpHistoryRefresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  return {
    scriptLoaded,
    historyRefreshKey,
    savedEnvironments,
    selectedEnvironmentId,
    applySavedEnvironment,
    browser,
    setBrowser,
    targetUrl,
    setTargetUrl,
    authMode,
    setAuthMode,
    cookieToken,
    setCookieToken,
    username,
    setUsername,
    password,
    setPassword,
    crawlEnabled,
    setCrawlEnabled,
    crawlMaxPages,
    setCrawlMaxPages,
    inspectionSteps,
    addInspectionStep,
    updateInspectionStep,
    removeInspectionStep,
    moveInspectionStep,
    inspecting,
    inspectError,
    inspectWarnings,
    elementMap,
    pageTitle,
    inspect,
    generating,
    generateError,
    script,
    setScript,
    generateCode,
    // Editing
    isEditingScript,
    editedCode,
    setEditedCode,
    savingEdit,
    saveEditError,
    startEditingScript,
    cancelEditingScript,
    saveEditedScript,
    deleteScript,
    // Run
    running,
    runError,
    runResult,
    runTest,
  };
}