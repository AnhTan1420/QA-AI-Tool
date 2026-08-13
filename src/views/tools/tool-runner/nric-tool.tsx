'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { generateNric, validateNric } from '@/lib/utils/nric';

export function NricTool() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<'generate' | 'validate'>('generate');
  const [type, setType] = useState<'nric' | 'fin'>('nric');
  const [count, setCount] = useState(5);
  const [generated, setGenerated] = useState('');
  const [inputValue, setInputValue] = useState('S1234567D');
  const [validation, setValidation] = useState<{ valid: boolean; reason: 'format' | 'checksum' | null } | null>(null);

  function handleGenerate() {
    setGenerated(Array.from({ length: count }, () => generateNric(type)).join('\n'));
  }

  function handleValidate() {
    setValidation(validateNric(inputValue));
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <button onClick={() => setMode('generate')} className={mode === 'generate' ? 'btn-primary' : 'btn-secondary'}>
          {t.tools.nric.generateTab}
        </button>
        <button onClick={() => setMode('validate')} className={mode === 'validate' ? 'btn-primary' : 'btn-secondary'}>
          {t.tools.nric.validateTab}
        </button>
      </div>

      {mode === 'generate' ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">{t.tools.nric.typeLabel}</span>
              <select value={type} onChange={(event) => setType(event.target.value as 'nric' | 'fin')} className="field-input">
                <option value="nric">{t.tools.nric.typeNric}</option>
                <option value="fin">{t.tools.nric.typeFin}</option>
              </select>
            </label>
            <label className="block">
              <span className="field-label">{t.tools.nric.countLabel}</span>
              <input type="number" min={1} max={100} value={count} onChange={(event) => setCount(Number(event.target.value))} className="field-input" />
            </label>
          </div>
          <button onClick={handleGenerate} className="btn-primary">
            {t.tools.nric.generateButton}
          </button>
          <pre className="overflow-auto rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{generated}</pre>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="field-label">{t.tools.nric.inputLabel}</span>
            <input value={inputValue} onChange={(event) => setInputValue(event.target.value)} className="field-input font-mono" />
          </label>
          <button onClick={handleValidate} className="btn-primary">
            {t.tools.nric.validateButton}
          </button>
          {validation && (
            <div className={`rounded-2xl p-4 font-bold text-white ${validation.valid ? 'bg-success-600' : 'bg-danger-600'}`}>
              {validation.valid
                ? t.tools.nric.validResult
                : validation.reason === 'format'
                  ? t.tools.nric.invalidFormat
                  : t.tools.nric.invalidChecksum}
            </div>
          )}
        </div>
      )}

      <p className="text-caption">{t.tools.nric.disclaimer}</p>
    </div>
  );
}
