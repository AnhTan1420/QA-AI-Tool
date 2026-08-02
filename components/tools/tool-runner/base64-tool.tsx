'use client';

import { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { ToolTextArea } from './tool-text-area';

export function Base64Tool() {
  const { t } = useLanguage();
  const [input, setInput] = useState(t.tools.base64Placeholder);
  const encoded = useMemo(() => (typeof window === 'undefined' ? '' : btoa(unescape(encodeURIComponent(input)))), [input]);
  const decoded = useMemo(() => {
    try {
      return decodeURIComponent(escape(atob(input)));
    } catch {
      return t.tools.base64InvalidInput;
    }
  }, [input, t]);

  return <ToolTextArea input={input} setInput={setInput} output={t.tools.base64Output(encoded, decoded)} />;
}
