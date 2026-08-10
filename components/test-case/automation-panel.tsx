'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import { useAutomation } from './automation/use-automation';
import { EnvironmentForm } from './automation/environment-form';
import { ElementPreview } from './automation/element-preview';
import { CodeViewer } from './automation/code-viewer';
import { RunResultPanel } from './automation/run-result';
import { AutomationHistory } from './automation/history-lists';

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
 * Workflow (simplified from the original 3-step to 2-step):
 *  1. Configure environment + (optionally) Inspect to build element map
 *  2. Click "Run Automation Test" — auto-generates code if none exists, then runs
 *
 * The CodeViewer section still provides the "Generate Playwright Code" button
 * separately if the user wants code-first control without running immediately.
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
        <div className="h-40 rounded-xl bg-gray-100" />
        <div className="h-32 rounded-xl bg-gray-100" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">{t.automation.intro}</p>

      {/* Step 1: Configure environment */}
      <EnvironmentForm automation={automation} />

      {/* Step 1b: Element map preview (optional but recommended) */}
      <ElementPreview automation={automation} />

      {/* Step 2a: Generated code viewer / editor */}
      <CodeViewer automation={automation} />

      {/* Step 2b: Unified Generate & Run button + result */}
      <RunResultPanel automation={automation} />

      {/* History (scripts + runs) */}
      <AutomationHistory testCaseId={testCase.id} refreshKey={automation.historyRefreshKey} />
    </div>
  );
}
