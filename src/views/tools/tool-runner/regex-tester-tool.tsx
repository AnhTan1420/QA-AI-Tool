'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export function RegexTesterTool() {
  const { t } = useLanguage();
  const [pattern, setPattern] = useState('^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$');
  const [input, setInput] = useState('tester@example.com');
  const result = useMemo(() => {
    try {
      return new RegExp(pattern, 'i').test(input) ? 'MATCH' : 'NO MATCH';
    } catch (error) {
      return error instanceof Error ? error.message : t.tools.regexInvalid;
    }
  }, [pattern, input, t]);

  return (
    <div className="space-y-4">
      <input value={pattern} onChange={(event) => setPattern(event.target.value)} className="field-input font-mono text-sm" />
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="field-input min-h-32" />
      <div className={`rounded-2xl p-4 font-bold text-white ${result === 'MATCH' ? 'bg-success-600' : result === 'NO MATCH' ? 'bg-ink-900' : 'bg-danger-600'}`}>
        {result}
      </div>
    </div>
  );
}
