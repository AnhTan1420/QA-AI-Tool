'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

const TS_KEYWORDS = /\b(import|from|export|const|let|var|async|await|function|return|if|else|new|type|interface)\b/g;

/**
 * Minimal regex-based TypeScript highlighter (comments -> strings -> keywords,
 * in that order so later passes don't re-color text already wrapped in a span).
 * Good enough for a short generated test file without pulling in a full
 * syntax-highlighting dependency.
 */
function highlight(code: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/(\/\/.*)$/gm, '<span class="text-slate-400">$1</span>')
    .replace(/(&#0*39;|'|")((?:(?!\1).)*)\1/g, (m) => `<span class="text-emerald-300">${m}</span>`)
    .replace(TS_KEYWORDS, '<span class="text-sky-300 font-semibold">$1</span>');
}

export function CodeViewer({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const c = t.automation.code;
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!automation.script) return;
    await navigator.clipboard.writeText(automation.script.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">{c.heading}</h3>
        <div className="flex items-center gap-2">
          {automation.script && (
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              {copied ? c.copied : c.copyButton}
            </button>
          )}
          <button
            type="button"
            onClick={automation.generateCode}
            disabled={automation.generating || automation.elementMap.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {automation.generating ? c.generating : c.generateButton}
          </button>
        </div>
      </div>

      {automation.generateError && <p className="mb-3 text-xs font-semibold text-red-600">{automation.generateError}</p>}

      {!automation.script ? (
        <p className="text-sm italic text-gray-400">{c.empty}</p>
      ) : (
        <>
          <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            <code dangerouslySetInnerHTML={{ __html: highlight(automation.script.code) }} />
          </pre>
          {automation.script.warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-xs font-bold text-amber-800">{c.warningsHeading}</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs text-amber-700">
                {automation.script.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
