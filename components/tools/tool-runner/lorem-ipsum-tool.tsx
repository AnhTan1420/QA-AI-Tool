'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { generateLoremText } from '@/lib/utils/lorem-ipsum';

export function LoremIpsumTool() {
  const { t } = useLanguage();
  const [unit, setUnit] = useState<'words' | 'sentences' | 'paragraphs'>('paragraphs');
  const [count, setCount] = useState(3);
  const [startWithLorem, setStartWithLorem] = useState(true);
  const output = useMemo(() => generateLoremText(unit, count, startWithLorem), [unit, count, startWithLorem]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="field-label">{t.tools.lorem.unitLabel}</span>
          <select value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)} className="field-input">
            <option value="words">{t.tools.lorem.unitWords}</option>
            <option value="sentences">{t.tools.lorem.unitSentences}</option>
            <option value="paragraphs">{t.tools.lorem.unitParagraphs}</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">{t.tools.lorem.countLabel}</span>
          <input type="number" min={1} max={200} value={count} onChange={(event) => setCount(Number(event.target.value))} className="field-input" />
        </label>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={startWithLorem} onChange={(event) => setStartWithLorem(event.target.checked)} />
        {t.tools.lorem.startWithLorem}
      </label>
      <pre className="min-h-40 overflow-auto whitespace-pre-wrap rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{output}</pre>
    </div>
  );
}
