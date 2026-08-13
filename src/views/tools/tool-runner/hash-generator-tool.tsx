'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

export function HashGeneratorTool() {
  const { t } = useLanguage();
  const [input, setInput] = useState('QAJD');
  const [hash, setHash] = useState('');

  async function generate(algorithm: 'SHA-1' | 'SHA-256') {
    const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
    setHash(Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join(''));
  }

  return (
    <div className="space-y-4">
      <textarea value={input} onChange={(event) => setInput(event.target.value)} className="field-input min-h-32" />
      <div className="flex gap-2">
        <button onClick={() => generate('SHA-1')} className="btn-ghost bg-ink-900 text-white hover:bg-ink-800">SHA-1</button>
        <button onClick={() => generate('SHA-256')} className="btn-primary">SHA-256</button>
      </div>
      <pre className="overflow-auto rounded-2xl bg-ink-900 p-4 text-sm text-emerald-300">{hash || t.tools.hashChoosePrompt}</pre>
    </div>
  );
}
