'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationState } from './use-automation';

export function BrowserProfileManager({ automation }: { automation: AutomationState }) {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [storageJson, setStorageJson] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/automation/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: automation.profiles[0]?.project_id,
          name,
          storage_state_json: storageJson || undefined,
        }),
      });
      setName('');
      setStorageJson('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 p-4 space-y-3">
      <h4 className="font-medium text-sm">{t.automation.browserProfile}</h4>
      <ul className="text-sm space-y-1">
        {automation.profiles.map((p) => (
          <li key={p.id} className="text-gray-700">{p.name}</li>
        ))}
      </ul>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t.automation.profileName}
        className="w-full rounded border px-2 py-1 text-sm"
      />
      <textarea
        value={storageJson}
        onChange={(e) => setStorageJson(e.target.value)}
        placeholder={t.automation.pasteStorageState}
        rows={3}
        className="w-full rounded border px-2 py-1 text-xs font-mono"
      />
      <button
        type="button"
        disabled={saving}
        onClick={handleCreate}
        className="text-sm px-3 py-1 border rounded-lg"
      >
        {t.automation.recordSession}
      </button>
    </div>
  );
}
