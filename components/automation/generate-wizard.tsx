'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationState } from './use-automation';
import type { GenerateConfig } from './types';

type Step = 1 | 2 | 3;

export function GenerateWizard({
  automation,
  defaultUrl,
  onClose,
  onSaved,
}: {
  automation: AutomationState;
  defaultUrl?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>(1);
  const [config, setConfig] = useState<GenerateConfig>({
    environment: 'chromium',
    target_url: defaultUrl ?? 'https://',
    useCredentials: false,
    credentials: { username: '', password: '' },
  });
  const [editedCode, setEditedCode] = useState('');
  const [saving, setSaving] = useState(false);

  const handleGenerate = async () => {
    const result = await automation.generateCode(config);
    setEditedCode(result.generated_code);
    setStep(2);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await automation.saveScript(config, editedCode);
      setStep(3);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{t.automation.generatePlaywright}</h3>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">
          {t.common.close}
        </button>
      </div>

      <div className="flex gap-2 text-xs">
        {[1, 2, 3].map((s) => (
          <span
            key={s}
            className={`px-2 py-1 rounded ${step === s ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}
          >
            {s === 1 ? t.automation.wizardConfig : s === 2 ? t.automation.wizardGeneration : t.automation.wizardResult}
          </span>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="text-gray-600">{t.automation.environment}</span>
            <select
              value={config.environment}
              onChange={(e) => setConfig({ ...config, environment: e.target.value as GenerateConfig['environment'] })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="chromium">Chromium</option>
              <option value="firefox">Firefox</option>
              <option value="webkit">WebKit</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">{t.automation.targetUrl}</span>
            <input
              type="url"
              value={config.target_url}
              onChange={(e) => setConfig({ ...config, target_url: e.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">{t.automation.browserProfile}</span>
            <select
              value={config.browser_profile_id ?? ''}
              onChange={(e) => setConfig({ ...config, browser_profile_id: e.target.value || undefined })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {automation.profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.useCredentials}
              onChange={(e) => setConfig({ ...config, useCredentials: e.target.checked })}
            />
            {t.automation.useCredentials}
          </label>
          {config.useCredentials && (
            <div className="grid grid-cols-2 gap-3">
              <input
                placeholder="Username"
                value={config.credentials?.username ?? ''}
                onChange={(e) => setConfig({ ...config, credentials: { ...config.credentials!, username: e.target.value } })}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Password"
                value={config.credentials?.password ?? ''}
                onChange={(e) => setConfig({ ...config, credentials: { ...config.credentials!, password: e.target.value } })}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          )}
          <button
            type="button"
            disabled={automation.generating}
            onClick={handleGenerate}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {automation.generating ? t.automation.generating : t.automation.generatePlaywright}
          </button>
        </div>
      )}

      {step === 2 && automation.generateResult && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {automation.generateResult.detected_elements.map((el) => (
              <span key={el} className="px-2 py-0.5 rounded bg-gray-100 text-xs text-gray-600">{el}</span>
            ))}
          </div>
          <textarea
            value={editedCode}
            onChange={(e) => setEditedCode(e.target.value)}
            rows={16}
            className="w-full font-mono text-xs rounded-lg border border-gray-300 p-3"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="px-3 py-1.5 text-sm border rounded-lg">
              {t.common.back}
            </button>
            <button type="button" onClick={handleGenerate} className="px-3 py-1.5 text-sm border rounded-lg">
              {t.automation.regenerate}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium"
            >
              {saving ? t.common.loading : t.automation.saveScript}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="text-center py-6 text-green-700">
          <p className="font-medium">{t.automation.saveSuccess}</p>
        </div>
      )}
    </div>
  );
}
