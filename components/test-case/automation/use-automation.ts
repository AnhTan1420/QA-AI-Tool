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

export type ScriptStatus = 'pending_review' | 'approved';

export type PlaywrightScript = {
  script_id: string | null;
  page_objects: PageObject[];
  code: string;
  imports_used: string[];
  selectors_used: string[];
  warnings: string[];
  /**
   * "Review Gate" state machine: a freshly generated/saved script always
   * starts 'pending_review'. It becomes 'approved' via either "Approve & Run"
   * or by saving an edit ("Edit / Tweak" self-approves). Run is blocked - both
   * in the UI and server-side (see app/api/automation/run/route.ts) - while
   * status is 'pending_review'.
   */
  status: ScriptStatus;
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

/**
 * All state + API calls for the "Automation" tab on the test case detail page.
 *
 * Key fixes/improvements in this pass:
 * 1. `deleteScript()` now actually calls DELETE /automation/scripts/[scriptId]
 *    (soft delete) instead of only clearing local React state — previously a
 *    "deleted" script would silently reappear after a page reload because the
 *    DB row was never touched.
 * 2. Removed the unused `generateAndRun()` combined flow — Generate and Run
 *    are already two separate, deliberate buttons in the UI (CodeViewer /
 *    RunResultPanel), this function was dead code left over from an earlier
 *    design.
 * 3. Script persistence — loads the single active (non-deleted) script from
 *    DB on mount so the code survives page reloads and navigation.
 * 4. In-place editing — `editedCode` lets the user modify the generated code
 *    in the UI without regenerating; `saveEditedScript()` persists the change
 *    (update-in-place, no new version) and updates `script` so the next Run
 *    uses the edited version.
 * 5. "Review Gate" state machine (see PlaywrightScript.status): a
 *    generated/saved script can't be run until it's reviewed —
 *    `approveScript()` / `approveAndRun()` approve without changing code,
 *    `saveEditedScript()` approves by editing. `runTest()` refuses to run a
 *    'pending_review' script (the server enforces this too).
 */
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

  // ── Load saved environments ───────────────────────────────────────────────
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

  // ── Load latest persisted script from DB on mount ─────────────────────────
  // This is the key persistence fix: without this, navigating away and back
  // loses the generated script (useState resets to null).
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
        // Latest version is first (ordered by version DESC in the API)
        const latest = json.data[0];
        setScript({
          script_id: latest.id,
          page_objects: latest.page_objects ?? [],
          code: latest.code,
          imports_used: latest.imports_used ?? [],
          selectors_used: latest.selectors_used ?? [],
          warnings: latest.warnings ?? [],
          status: latest.status === 'approved' ? 'approved' : 'pending_review',
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

  // ── In-place script editing ───────────────────────────────────────────────
  const [isEditingScript, setIsEditingScript] = useState(false);
  const [editedCode, setEditedCode] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveEditError, setSaveEditError] = useState('');

  function startEditingScript() {
    if (!script) return;
    setEditedCode(script.code);
    setIsEditingScript(true);
    setSaveEditError('');
  }

  function cancelEditingScript() {
    setIsEditingScript(false);
    setEditedCode('');
    setSaveEditError('');
  }

  /**
   * Saves the edited code by updating the current script in place (this
   * branch is single-active-script, no version history — see the POST
   * handler in app/api/test-cases/[id]/automation/scripts/route.ts).
   */
  async function saveEditedScript() {
    if (!script || !editedCode.trim()) return;
    setSavingEdit(true);
    setSaveEditError('');
    try {
      const res = await fetch('/api/test-cases/' + testCaseId + '/automation/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // FIX: this was missing, so every save hit the API's "insert new"
          // branch (hardcoded version: 1) instead of updating the existing
          // row in place — silently orphaning the original script row every
          // time (never soft-deleted, just abandoned) and leaving multiple
          // undeleted version:1 rows for the same test case, which made
          // "which script shows after reload" a coin flip (ORDER BY version
          // DESC ties on identical version numbers).
          script_id: script.script_id ?? undefined,
          code: editedCode,
          page_objects: script.page_objects,
          imports_used: script.imports_used,
          selectors_used: script.selectors_used,
          warnings: [...script.warnings, 'Manually edited by user.'],
        }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Save failed');
      // Saving an edit self-approves (see POST .../scripts doc comment) — the
      // "Edit / Tweak" branch of the Review Gate always lands on 'approved'.
      setScript({ ...script, code: editedCode, script_id: json.data.id, status: 'approved' });
      setIsEditingScript(false);
      setEditedCode('');
      bumpHistoryRefresh();
    } catch (err) {
      setSaveEditError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingEdit(false);
    }
  }

  const [deletingScript, setDeletingScript] = useState(false);
  const [deleteScriptError, setDeleteScriptError] = useState('');

  /**
   * Deletes the current script via DELETE /automation/scripts/[scriptId] (soft
   * delete — sets deleted_at, see that route). FIX: this previously only
   * cleared local React state and never called the API at all, so after a
   * page reload the GET route (which already filters deleted_at is null)
   * would just re-fetch the "deleted" script from DB and it would reappear.
   * Run history is unaffected by the delete either way — automation_runs
   * keeps its own code_snapshot/page_objects_snapshot per run.
   */
  async function deleteScript() {
    if (!script?.script_id) return;
    const confirmed = window.confirm('Delete this generated script? The run history will be kept.');
    if (!confirmed) return;

    setDeletingScript(true);
    setDeleteScriptError('');
    try {
      const res = await fetch(`/api/test-cases/${testCaseId}/automation/scripts/${script.script_id}`, {
        method: 'DELETE',
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Delete failed');
      setScript(null);
      setIsEditingScript(false);
      setEditedCode('');
      bumpHistoryRefresh();
    } catch (err) {
      setDeleteScriptError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingScript(false);
    }
  }

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const bumpHistoryRefresh = useCallback(() => setHistoryRefreshKey((k) => k + 1), []);

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');

  /**
   * "Approve & Run" branch of the Review Gate: marks the current script
   * 'approved' WITHOUT changing its code (contrast with saveEditedScript(),
   * which approves BY changing the code). Returns true on success so callers
   * (approveAndRun) know it's safe to proceed to runTest().
   */
  async function approveScript(): Promise<boolean> {
    if (!script?.script_id) return false;
    if (script.status === 'approved') return true;
    setApproving(true);
    setApproveError('');
    try {
      const res = await fetch(`/api/test-cases/${testCaseId}/automation/scripts/${script.script_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Approve failed');
      setScript((current) => (current ? { ...current, status: 'approved' } : current));
      bumpHistoryRefresh();
      return true;
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Approve failed');
      return false;
    } finally {
      setApproving(false);
    }
  }

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
      // A fresh generation always starts 'pending_review' (Review Gate) — the API
      // already returns status: 'pending_review', but default it defensively here too.
      const generated: PlaywrightScript = {
        ...json.data,
        status: json.data.status === 'approved' ? 'approved' : 'pending_review',
      };
      setScript(generated);
      bumpHistoryRefresh();
      return generated;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generate failed';
      setGenerateError(msg);
      throw err;
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Runs the currently loaded/edited script. Generate and Run are already two
   * separate deliberate actions in this UI (RunResultPanel only calls this,
   * never auto-generates) — the button that calls this stays disabled while
   * `script` is null (see RunResultPanel's `canRun`). Also enforces the
   * Review Gate client-side (the server enforces it too, see
   * app/api/automation/run/route.ts): refuses to run a 'pending_review'
   * script — see approveAndRun() for the "Approve & Run" one-click path.
   */
  async function runTest() {
    if (!script || script.status !== 'approved') return;
    await runTestWith(script);
  }

  /**
   * "Approve & Run" — the other half of the Review Gate's two exits from
   * 'pending_review' (the other being "Edit / Tweak" → saveEditedScript()).
   * Approves the script as-is, then runs it, in one click.
   */
  async function approveAndRun() {
    if (!script) return;
    const approved = script.status === 'approved' ? true : await approveScript();
    if (!approved) return;
    // approveScript() already flipped `script.status` in state via setScript,
    // but that update may not have flushed into this closure's `script` yet —
    // build the post-approval object explicitly rather than relying on it.
    await runTestWith({ ...script, status: 'approved' });
  }

  async function runTestWith(scriptToRun: PlaywrightScript) {
    setRunning(true);
    setRunError('');
    try {
      const res = await fetch('/api/automation/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          test_case_id: testCaseId,
          script_id: scriptToRun.script_id ?? undefined,
          code: scriptToRun.script_id ? undefined : scriptToRun.code,
          page_objects: scriptToRun.script_id ? undefined : scriptToRun.page_objects,
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
    deletingScript,
    deleteScriptError,
    // Review Gate
    approveScript,
    approving,
    approveError,
    approveAndRun,
    // Run
    running,
    runError,
    runResult,
    runTest,
  };
}
