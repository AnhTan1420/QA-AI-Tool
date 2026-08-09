'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

export function ElementPreview({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const p = t.automation.elementPreview;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-700">{p.heading}</h3>

      {automation.elementMap.length === 0 ? (
        <p className="text-sm italic text-gray-400">{p.empty}</p>
      ) : (
        <>
          {automation.pageTitle && (
            <p className="mb-3 text-xs text-gray-500">
              <span className="font-semibold">{p.pageTitleLabel}:</span> {automation.pageTitle}
            </p>
          )}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {automation.elementMap.map((el, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-xs">
                <span className="rounded bg-slate-200 px-1.5 py-0.5 font-mono font-semibold text-slate-700">{el.role}</span>
                <span className="truncate text-gray-700">{el.accessible_name || <em className="text-gray-400">(no name)</em>}</span>
                <span className="ml-auto shrink-0 font-mono text-gray-400">{el.selector}</span>
                {!el.is_visible && <span className="shrink-0 rounded bg-amber-100 px-1 text-amber-700">hidden</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
