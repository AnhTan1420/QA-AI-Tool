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
 * "Automation" section on the test case detail page (Phase 3 roadmap item —
 * see README.md). Workflow: configure environment -> Inspect (real DOM/element
 * map) -> Generate Playwright Code (grounded in that map) -> copy for an
 * external suite and/or Run Automation Test right here, with a screenshot and
 * annotated failure callout. Lives next to VersionHistory/CommentsPanel, same
 * visual language (cards, badges, spacing).
 */
export default function AutomationPanel({ testCase }: { testCase: TestCaseForAutomation }) {
  const { t } = useLanguage();
  const automation = useAutomation(testCase.id, {
    title: testCase.title,
    preconditions: testCase.preconditions,
    steps: testCase.steps,
    expected_result: testCase.expected_result,
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">{t.automation.intro}</p>
      <EnvironmentForm automation={automation} />
      <ElementPreview automation={automation} />
      <CodeViewer automation={automation} />
      <RunResultPanel automation={automation} />
      <AutomationHistory testCaseId={testCase.id} />
    </div>
  );
}
