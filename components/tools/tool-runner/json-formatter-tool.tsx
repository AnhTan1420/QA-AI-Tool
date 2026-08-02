'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { ToolTextArea } from './tool-text-area';

export function JsonFormatterTool() {
  const { t } = useLanguage();
  const [input, setInput] = useState('{"project":"QAJD","phase":1}');
  const result = useMemo(() => {
    try {
      return { ok: true, value: JSON.stringify(JSON.parse(input), null, 2) };
    } catch (error) {
      return { ok: false, value: error instanceof Error ? error.message : t.tools.jsonInvalid };
    }
  }, [input, t]);

  return <ToolTextArea input={input} setInput={setInput} output={result.value} tone={result.ok ? 'success' : 'error'} />;
}
