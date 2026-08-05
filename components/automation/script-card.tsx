'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationState } from './use-automation';
import type { AutomationScript } from './types';
import { RunHistoryTable } from './run-history-table';

const BROWSER_ICONS: Record<string, string> = {
  chromium: '🌐',
  firefox: '🦊',
  webkit: '🧭',
};

export function ScriptCard({
  automation,
  script,
}: {
  automation: AutomationState;
  script: AutomationScript;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(script.generated_code);
  const lastRun = automation.runs[0];

  const handleSaveEdit = async () => {
    await automation.updateScriptCode(script.id, code);
    setEditing(false);
  };

  const downloadSpec = () => {
    const blob = new Blob([code], { type: 'text/typescript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${script.id}.spec.ts`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xl">{BROWSER_ICONS[script.environment] ?? '🌐'}</span>
          <div>
            <p className="text-sm font-medium text-gray-900 truncate max-w-md">{script.target_url}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="px-2 py-0.5 rounded text-xs bg-gray-100 capitalize">{script.status}</span>
              {lastRun && (
                <span
                  className={`w-2 h-2 rounded-full ${lastRun.status === 'passed' ? 'bg-green-500' : 'bg-red-500'}`}
                  title={lastRun.status}
                />
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={automation.running}
            onClick={() => automation.runScript(script.id)}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {t.automation.runTest}
          </button>
          <button
            type="button"
            disabled={automation.running}
            onClick={() => automation.runScript(script.id, ['chromium', 'firefox', 'webkit'])}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {t.automation.runCrossBrowser}
          </button>
        </div>
      </div>

      <div className="px-5 py-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 hover:underline"
        >
          {expanded ? t.automation.hideCode : t.automation.viewSource}
        </button>
        {expanded && (
          <div className="mt-3 space-y-2">
            {editing ? (
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                rows={14}
                className="w-full font-mono text-xs rounded-lg border p-3"
                spellCheck={false}
              />
            ) : (
              <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-80">{code}</pre>
            )}
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button type="button" onClick={handleSaveEdit} className="text-sm px-3 py-1 border rounded-lg">
                    {t.automation.saveScript}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="text-sm px-3 py-1 border rounded-lg">
                    {t.common.cancel}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setEditing(true)} className="text-sm px-3 py-1 border rounded-lg">
                    {t.automation.editCode}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(code)}
                    className="text-sm px-3 py-1 border rounded-lg"
                  >
                    {t.automation.copyCode}
                  </button>
                  <button type="button" onClick={downloadSpec} className="text-sm px-3 py-1 border rounded-lg">
                    {t.automation.download}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {automation.runs.length > 0 && (
        <div className="px-5 pb-4">
          <RunHistoryTable runs={automation.runs} scriptId={script.id} compact />
        </div>
      )}
    </div>
  );
}
