'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

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

export type PlaywrightScript = {
  script_id: string | null;
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

type TestCaseForCodegen = {
  title: string;
  preconditions: string[];
  steps: { step_number: number; action: string; expected_result: string }[];
  expected_result: string;
};

/** All state + API calls for the "Automation" tab on the test case detail page. */
export function useAutomation(testCaseId: string, testCase: TestCaseForCodegen) {
  const { locale } = useLanguage();

  const [browser, setBrowser] = useState<AutomationBrowser>('chromium');
  const [targetUrl, setTargetUrl] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('none');
  const [cookieToken, setCookieToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState('');
  const [elementMap, setElementMap] = useState<InspectedElement[]>([]);
  const [pageTitle, setPageTitle] = useState('');

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [script, setScript] = useState<PlaywrightScript | null>(null);

  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  const [runResult, setRunResult] = useState<RunResult | null>(null);

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
    try {
      const res = await fetch('/api/automation/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: buildEnvironmentPayload() }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Inspect failed');
      setElementMap(json.data.element_map);
      setPageTitle(json.data.page_title);
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
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Generate failed');
      setScript(json.data);
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
          environment: buildEnvironmentPayload(),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Run failed');
      setRunResult(json.data);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  return {
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
    inspecting,
    inspectError,
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
