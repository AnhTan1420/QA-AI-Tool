'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { useAutomation } from '@/hooks/test-case/use-automation';
import { EnvironmentForm } from './environment-form';
import { ElementPreview } from './element-preview';
import { CodeViewer } from './code-viewer';
import { RunResultPanel } from './run-result';
import { AutomationHistory } from './history-lists';

type TestCaseForAutomation = {
  id: string;
  title: string;
  preconditions: string[];
  steps: { step_number: number; action: string; expected_result: string }[];
  expected_result: string;
};

/**
 * Automation tab on the test case detail page.
 *
 * Workflow:
 *  1. Configure environment + (optionally) Inspect to build element map
 *  2. Click "Generate Playwright Code" (CodeViewer)
 *  3. Review / edit the code in place if needed (CodeViewer's Edit button)
 *  4. Click "Run Test" (RunResultPanel) — executes the current script; stays
 *     disabled until a script exists, never generates code on its own.
 */
export default function AutomationPanel({
  testCase,
  projectId,
}: {
  testCase: TestCaseForAutomation;
  projectId?: string;
}) {
  const { t } = useLanguage();
  const automation = useAutomation(
    testCase.id,
    {
      title: testCase.title,
      preconditions: testCase.preconditions,
      steps: testCase.steps,
      expected_result: testCase.expected_result,
    },
    projectId,
  );

  if (!automation.scriptLoaded) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-40 rounded-[var(--radius-card)] bg-ink-100" />
        <div className="h-32 rounded-[var(--radius-card)] bg-ink-100" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-body">{t.automation.intro}</p>

      {/* Step 1: Configure environment */}
      <EnvironmentForm automation={automation} />

      {/* Step 1b: Element map preview (optional but recommended) */}
      <ElementPreview automation={automation} />

      {/* Step 2a: Generated code viewer / editor */}
      <CodeViewer automation={automation} />

      {/* Step 2b: Run + result */}
      <RunResultPanel automation={automation} />

      {/* Run history (with screenshots) */}
      <AutomationHistory testCaseId={testCase.id} refreshKey={automation.historyRefreshKey} />
    </div>
  );
}
