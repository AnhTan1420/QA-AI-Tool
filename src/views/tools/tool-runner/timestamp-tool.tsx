'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export function TimestampTool() {
  const { locale } = useLanguage();
  const [timestamp, setTimestamp] = useState(1704067200);
  const date = useMemo(() => new Date(timestamp * 1000), [timestamp]);

  return (
    <div className="space-y-4">
      <input type="number" value={timestamp} onChange={(event) => setTimestamp(Number(event.target.value))} className="field-input" />
      <div className="surface-card p-4">
        <p className="font-bold text-ink-900">{date.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US')}</p>
        <p className="text-caption mt-1">ISO: {date.toISOString()}</p>
      </div>
    </div>
  );
}
