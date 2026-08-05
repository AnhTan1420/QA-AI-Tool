'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationState } from './use-automation';
import type { DiscoveryCase } from './types';

export function DiscoveryPanel({
  automation,
  defaultUrl,
  onClose,
}: {
  automation: AutomationState;
  defaultUrl?: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [url, setUrl] = useState(defaultUrl ?? 'https://');
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setSelected(next);
  };

  const handleBulkSave = async () => {
    const cases = automation.discoveryResults.filter((_, i) => selected.has(i));
    await automation.bulkSaveDiscovery(cases);
    onClose();
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">{t.automation.autoDiscover}</h3>
        <button type="button" onClick={onClose} className="text-sm text-gray-500">{t.common.close}</button>
      </div>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={automation.discovering}
          onClick={() => automation.discoverElements(url)}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-50"
        >
          {automation.discovering ? t.common.loading : t.automation.discoverElements}
        </button>
      </div>
      {automation.discoveryResults.length > 0 && (
        <>
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {automation.discoveryResults.map((c: DiscoveryCase, i) => (
              <li key={i} className="flex gap-2 items-start border rounded-lg p-3 text-sm">
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} className="mt-1" />
                <div>
                  <p className="font-medium">{c.title}</p>
                  <p className="text-gray-500 text-xs capitalize">{c.category} · {c.priority}</p>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={handleBulkSave}
            className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm disabled:opacity-50"
          >
            {t.automation.bulkSave} ({selected.size})
          </button>
        </>
      )}
    </div>
  );
}
