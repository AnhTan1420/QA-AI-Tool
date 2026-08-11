'use client';

import { ScanEye } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

export function ElementPreview({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const p = t.automation.elementPreview;

  return (
    <div className="surface-card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="panel-icon">
          <ScanEye className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <h3 className="text-h3">{p.heading}</h3>
      </div>

      {automation.elementMap.length === 0 ? (
        <p className="text-caption italic">{p.empty}</p>
      ) : (
        <>
          {automation.pageTitle && (
            <p className="mb-3 text-caption">
              <span className="font-semibold text-ink-700">{p.pageTitleLabel}:</span> {automation.pageTitle}
            </p>
          )}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {automation.elementMap.map((el, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-[var(--radius-control)] bg-ink-50 px-3 py-1.5 text-xs">
                <span className="rounded-md bg-ink-200/70 px-1.5 py-0.5 font-mono font-semibold text-ink-700">{el.role}</span>
                <span className="truncate text-ink-700">{el.accessible_name || <em className="text-ink-400">(no name)</em>}</span>
                <span className="ml-auto shrink-0 font-mono text-ink-400">{el.selector}</span>
                {!el.is_visible && <span className="badge-warning shrink-0 !px-1.5 !py-0.5">hidden</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
