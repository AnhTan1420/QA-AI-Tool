'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationState } from './use-automation';

export function NaturalRunner({
  automation,
  defaultUrl,
}: {
  automation: AutomationState;
  defaultUrl?: string;
}) {
  const { t } = useLanguage();
  const [task, setTask] = useState('');
  const [url, setUrl] = useState(defaultUrl ?? 'https://');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
      <h3 className="font-semibold text-gray-900">{t.automation.naturalLanguageRun}</h3>
      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        placeholder={t.automation.naturalTaskPlaceholder}
        rows={3}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        placeholder={t.automation.targetUrl}
      />
      <button
        type="button"
        disabled={automation.running || task.length < 5}
        onClick={() => automation.runNaturalTask(task, url)}
        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {automation.running ? t.automation.runningTest : t.automation.runNaturalTask}
      </button>
    </div>
  );
}
