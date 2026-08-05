'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationState } from './use-automation';
import { GenerateWizard } from './generate-wizard';
import { ScriptCard } from './script-card';
import { NaturalRunner } from './natural-runner';
import { DiscoveryPanel } from './discovery-panel';
import { RunResultViewer } from './run-result-viewer';

export function AutomationPanel({
  automation,
  defaultUrl,
}: {
  automation: AutomationState;
  defaultUrl?: string;
}) {
  const { t } = useLanguage();
  const [showWizard, setShowWizard] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);

  if (automation.loading) {
    return <div className="text-gray-500 text-sm">{t.common.loading}</div>;
  }

  return (
    <div className="space-y-6">
      {automation.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {automation.error}
        </div>
      )}

      {!automation.primaryScript && !showWizard && (
        <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center space-y-4">
          <p className="text-gray-600">{t.automation.noScriptHint}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              {t.automation.generatePlaywright}
            </button>
            <button
              type="button"
              onClick={() => setShowDiscovery(true)}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
            >
              {t.automation.autoDiscover}
            </button>
          </div>
        </div>
      )}

      {showWizard && (
        <GenerateWizard
          automation={automation}
          defaultUrl={defaultUrl}
          onClose={() => setShowWizard(false)}
          onSaved={() => setShowWizard(false)}
        />
      )}

      {showDiscovery && (
        <DiscoveryPanel
          automation={automation}
          defaultUrl={defaultUrl}
          onClose={() => setShowDiscovery(false)}
        />
      )}

      {automation.primaryScript && (
        <ScriptCard automation={automation} script={automation.primaryScript} />
      )}

      <NaturalRunner automation={automation} defaultUrl={defaultUrl} />

      {(automation.running || automation.activeRun) && (
        <RunResultViewer running={automation.running} run={automation.activeRun} />
      )}
    </div>
  );
}
