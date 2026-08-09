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

// Client-side draft of 1 inspection_steps[] entry (see lib/validators/playwright.ts#inspectionStepSchema).
// `id` is a local-only key for React lists / edits - never sent to the API.
export type InspectionStepDraft = {
  id: string;
  label: string;
  action: InspectionStepAction;
  selector: string; // required for click/fill/press_enter
  value: string; // required for fill
  url: string; // required for goto
};

const MAX_INSPECTION_STEPS = 10; // mirrors inspectionStepSchema's .max(10) on the server

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

/**
 * All state + API calls for the "Automation" tab on the test case detail page.
 *
 * `projectId` is optional (kept backward-compatible for any other caller) but should be
 * passed whenever available: it lets this tab reuse a project's saved, non-secret
 * `project_environments` (Staging/Production/...) the same way the batch "Run Automation
 * on N test cases" modal already does, instead of forcing the browser/target URL to be
 * retyped by hand for every single test case. Secrets (cookie/login) are still entered
 * fresh here regardless - saved environments never store them, same rule everywhere else.
 */
export function useAutomation(testCaseId: string, testCase: TestCaseForCodegen, projectId?: string) {
  const { locale } = useLanguage();

  const [browser, setBrowser] = useState<AutomationBrowser>('chromium');
  const [targetUrl, setTargetUrl] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [cookieToken, setCookieToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Saved project environments (Staging/Production/...) — quick-select convenience only;
  // never a source of secrets. Silently unavailable (empty list) if projectId isn't passed.
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
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  function applySavedEnvironment(id: string) {
    setSelectedEnvironmentId(id);
    const env = savedEnvironments.find((e) => e.id === id);
    if (!env) return;
    setBrowser(env.browser);
    setTargetUrl(env.target_url);
    setAuthMode(env.auth_mode);
    // Secrets are never stored on a saved environment - always re-entered here.
    setCookieToken('');
    setUsername('');
    setPassword('');
  }

  const [crawlEnabled, setCrawlEnabled] = useState(false);
  const [crawlMaxPages, setCrawlMaxPages] = useState(5);

  // Multi-step inspection (Requirement 2 extension): drive the browser through a login
  // redirect / modal / wizard BEFORE snapshotting, so multi-page flows end up grounded in
  // the element map instead of the codegen prompt only ever seeing the first page loaded.
  // Backend (inspectRequestSchema/runInspectionStep) has supported this since the previous
  // audit pass; this is the UI that was missing to actually drive it.
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

  /** Drops the local-only `id` and empty optional fields before sending to the API. */
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
  // Non-fatal signals from Inspect (e.g. "step 'Click Sign in' failed, element map may be
  // stale", "element map truncated at 400 elements") - previously fetched but silently
  // discarded, so a partially-broken multi-step inspect looked identical to a clean one.
  const [inspectWarnings, setInspectWarnings] = useState<string[]>([]);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [script, setScript] = useState<PlaywrightScript | null>(null);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  // Bumped after a script is successfully generated or a run finishes, so
  // <AutomationHistory> (which otherwise only fetches once on mount) knows to
  // re-fetch and show the new version/run without requiring a full page reload.
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
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generate failed');
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
    generateCode,
    running,
    runError,
    runResult,
    runTest,
  };
}