'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

const TS_KEYWORDS = /\b(import|from|export|const|let|var|async|await|function|return|if|else|new|type|interface|class|private|constructor)\b/g;

function highlight(code: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/(\/\/.*)$/gm, '<span class="text-slate-400">$1</span>')
    .replace(/(&#0*39;|'|")((?:(?!\1).)*)(\1)/g, (m) => `<span class="text-emerald-300">${m}</span>`)
    .replace(TS_KEYWORDS, '<span class="text-sky-300 font-semibold">$1</span>');
}

type ActiveTab = 'spec' | `page:${number}`;

export function CodeViewer({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const c = t.automation.code;
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('spec');

  const pageObjects = automation.script?.page_objects ?? [];
  const activePageObject =
    activeTab !== 'spec' ? pageObjects[Number(activeTab.split(':')[1])] : undefined;
  const activeCode = automation.isEditingScript
    ? automation.editedCode
    : activeTab === 'spec'
    ? automation.script?.code
    : activePageObject?.code;
  const activeFileName = activeTab === 'spec' ? 'spec.ts' : activePageObject?.file_name;

  async function handleCopy() {
    if (!activeCode) return;
    await navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleDownload() {
    if (!activeCode) return;
    const blob = new Blob([activeCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFileName ?? 'playwright-spec.ts';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">{c.heading}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {automation.script && !automation.isEditingScript && (
            <>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                {copied ? c.copied : c.copyButton}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                ↓ Download
              </button>
              <button
                type="button"
                onClick={automation.startEditingScript}
                className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
              >
                ✎ Edit
              </button>
              <button
                type="button"
                onClick={automation.deleteScript}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                ✕ Delete
              </button>
            </>
          )}
          {automation.isEditingScript ? (
            <>
              <button
                type="button"
                onClick={automation.saveEditedScript}
                disabled={automation.savingEdit}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {automation.savingEdit ? 'Saving...' : '✓ Save'}
              </button>
              <button
                type="button"
                onClick={automation.cancelEditingScript}
                disabled={automation.savingEdit}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={automation.generateCode}
              disabled={automation.generating || automation.elementMap.length === 0}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {automation.generating ? c.generating : automation.script ? '↺ Regenerate' : c.generateButton}
            </button>
          )}
        </div>
      </div>

      {automation.generateError && (
        <p className="mb-3 text-xs font-semibold text-red-600">{automation.generateError}</p>
      )}
      {automation.saveEditError && (
        <p className="mb-3 text-xs font-semibold text-red-600">{automation.saveEditError}</p>
      )}

      {!automation.script ? (
        <p className="text-sm italic text-gray-400">{c.empty}</p>
      ) : (
        <>
          {!automation.isEditingScript && (
            <div className="mb-3 flex flex-wrap gap-1.5 border-b border-gray-100 pb-3">
              {pageObjects.map((po, i) => {
                const tab: ActiveTab = `page:${i}`;
                const isActive = activeTab === tab;
                return (
                  <button
                    key={po.file_name}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    title={po.page_label || po.file_name}
                    className={`rounded-md px-2.5 py-1 text-xs font-mono ${
                      isActive ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {po.file_name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setActiveTab('spec')}
                className={`rounded-md px-2.5 py-1 text-xs font-mono ${
                  activeTab === 'spec' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {c.specTabLabel}
              </button>
            </div>
          )}

          {!automation.isEditingScript && activePageObject?.page_label && (
            <p className="mb-2 text-xs text-gray-400">{c.pageObjectForLabel(activePageObject.page_label)}</p>
          )}
          {!automation.isEditingScript && activeFileName && (
            <p className="mb-1 font-mono text-[11px] text-gray-400">{activeFileName}</p>
          )}

          {automation.isEditingScript ? (
            <div>
              <p className="mb-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                ✎ Editing spec.ts — changes saved as a new version. Page Object files cannot be edited here individually.
              </p>
              <textarea
                value={automation.editedCode}
                onChange={(e) => automation.setEditedCode(e.target.value)}
                spellCheck={false}
                className="w-full h-96 rounded-lg bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y whitespace-pre-wrap break-words"
              />
            </div>
          ) : (
            <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
              <code dangerouslySetInnerHTML={{ __html: highlight(activeCode ?? '') }} />
            </pre>
          )}

          {!automation.isEditingScript && automation.script.warnings.length > 0 && (
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