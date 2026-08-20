'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export function UuidTool() {
  const { t } = useLanguage();
  const [count, setCount] = useState(5);
  const values = useMemo(() => Array.from({ length: count }, () => crypto.randomUUID()).join('\n'), [count]);

  return (
    <div className="space-y-4">
      <label className="field-label">{t.tools.uuidCountLabel}</label>
      <input type="number" min={1} max={50} value={count} onChange={(event) => setCount(Number(event.target.value))} className="field-input w-32" />
      <pre className="overflow-auto rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{values}</pre>
    </div>
  );
}
