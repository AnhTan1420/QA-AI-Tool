'use client';

import { useState } from 'react';
import { Code2, Copy, Check, Download, Pencil, Trash2, RotateCcw, Sparkles, Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

const TS_KEYWORDS = /\b(import|from|export|const|let|var|async|await|function|return|if|else|new|type|interface|class|private|constructor)\b/g;

function highlight(code: string): string {
  const escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/(\/\/.*)$/gm, '<span class="text-ink-400">$1</span>')
    .replace(/(&#0*39;|'|")((?:(?!\1).)*)(\1)/g, (m) => `<span class="text-emerald-300">${m}</span>`)
    .replace(TS_KEYWORDS, '<span class="text-brand-300 font-semibold">$1</span>');
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
    <div className="surface-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="panel-icon">
            <Code2 className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <h3 className="text-h3">{c.heading}</h3>
          {automation.script && !automation.isEditingScript && (
            <span className={automation.script.status === 'approved' ? 'badge-success' : 'badge-warning'}>
              {automation.script.status === 'approved' ? 'Approved' : 'Pending review'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {automation.script && !automation.isEditingScript && (
            <>
              <button type="button" onClick={handleCopy} className="btn-secondary btn-sm">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? c.copied : c.copyButton}
              </button>
              <button type="button" onClick={handleDownload} className="btn-secondary btn-sm">
                <Download className="h-3.5 w-3.5" />
                Download
              </button>
              <button
                type="button"
                onClick={automation.startEditingScript}
                title="Edit / Tweak — saving approves this version"
                className="btn-secondary btn-sm"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
              <button
                type="button"
                onClick={automation.deleteScript}
                disabled={automation.deletingScript}
                className="btn-secondary btn-sm !text-danger-600 hover:!border-danger-600/30 hover:!bg-danger-50"
              >
                {automation.deletingScript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {automation.deletingScript ? 'Deleting...' : 'Delete'}
              </button>
            </>
          )}
          {automation.isEditingScript ? (
            <>
              <button
                type="button"
                onClick={automation.saveEditedScript}
                disabled={automation.savingEdit}
                className="btn-primary btn-sm"
              >
                {automation.savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {automation.savingEdit ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={automation.cancelEditingScript}
                disabled={automation.savingEdit}
                className="btn-ghost btn-sm"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={automation.generateCode}
              disabled={automation.generating || automation.elementMap.length === 0}
              className="btn-primary btn-sm"
            >
              {automation.generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : automation.script ? (
                <RotateCcw className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {automation.generating ? c.generating : automation.script ? 'Regenerate' : c.generateButton}
            </button>
          )}
        </div>
      </div>

      {automation.generateError && <p className="alert-danger mb-3 !p-3">{automation.generateError}</p>}
      {automation.saveEditError && <p className="alert-danger mb-3 !p-3">{automation.saveEditError}</p>}
      {automation.deleteScriptError && <p className="alert-danger mb-3 !p-3">{automation.deleteScriptError}</p>}

      {!automation.script ? (
        <p className="text-caption italic">{c.empty}</p>
      ) : (
        <>
          {!automation.isEditingScript && (
            <div className="mb-3 flex flex-wrap gap-1.5 border-b border-ink-100 pb-3">
              {pageObjects.map((po, i) => {
                const tab: ActiveTab = `page:${i}`;
                const isActive = activeTab === tab;
                return (
                  <button
                    key={po.file_name}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    title={po.page_label || po.file_name}
                    className={`rounded-md px-2.5 py-1 text-xs font-mono transition-colors ${
                      isActive ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                    }`}
                  >
                    {po.file_name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setActiveTab('spec')}
                className={`rounded-md px-2.5 py-1 text-xs font-mono transition-colors ${
                  activeTab === 'spec' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                }`}
              >
                {c.specTabLabel}
              </button>
            </div>
          )}

          {!automation.isEditingScript && activePageObject?.page_label && (
            <p className="mb-2 text-caption">{c.pageObjectForLabel(activePageObject.page_label)}</p>
          )}
          {!automation.isEditingScript && activeFileName && (
            <p className="mb-1 font-mono text-[11px] text-ink-400">{activeFileName}</p>
          )}

          {automation.isEditingScript ? (
            <div>
              <p className="alert-info mb-2 !border-warning-600/20 !bg-warning-50 !p-3 !text-warning-600">
                Editing spec.ts — saving updates this script in place and approves it (Review Gate). Page Object files cannot be edited here individually.
              </p>
              <textarea
                value={automation.editedCode}
                onChange={(e) => automation.setEditedCode(e.target.value)}
                spellCheck={false}
                className="h-96 w-full resize-y whitespace-pre-wrap break-words rounded-[var(--radius-control)] bg-ink-900 p-4 font-mono text-xs leading-relaxed text-ink-100 outline-none focus:ring-4 focus:ring-brand-200"
              />
            </div>
          ) : (
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-control)] bg-ink-900 p-4 text-xs leading-relaxed text-ink-100">
              <code dangerouslySetInnerHTML={{ __html: highlight(activeCode ?? '') }} />
            </pre>
          )}

          {!automation.isEditingScript && automation.script.warnings.length > 0 && (
            <div className="mt-3 rounded-[var(--radius-control)] border border-warning-600/20 bg-warning-50 p-3">
              <p className="mb-1 text-xs font-bold text-warning-600">{c.warningsHeading}</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs text-warning-600/90">
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
