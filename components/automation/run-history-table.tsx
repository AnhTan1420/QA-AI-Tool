'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { AutomationRun } from './types';

export function RunHistoryTable({
  runs,
  scriptId,
  compact = false,
}: {
  runs: AutomationRun[];
  scriptId: string;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'healed'>('all');

  const filtered = runs.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'passed') return r.status === 'passed';
    if (filter === 'failed') return r.status === 'failed' || r.status === 'error';
    if (filter === 'healed') return Boolean(r.healing_log?.retried);
    return true;
  });

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex gap-2 text-xs">
          {(['all', 'passed', 'failed', 'healed'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded capitalize ${filter === f ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 text-left">
            <th className="py-2">{t.automation.colStatus}</th>
            <th className="py-2">{t.automation.colDuration}</th>
            {!compact && <th className="py-2">{t.automation.visualRegression}</th>}
            <th className="py-2">{t.automation.colDate}</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id} className="border-t border-gray-100">
              <td className="py-2 capitalize">
                {r.status}
                {r.healing_log?.retried && ' ✨'}
              </td>
              <td className="py-2">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}</td>
              {!compact && (
                <td className="py-2">{r.visual_regression_score != null ? `${r.visual_regression_score}%` : '—'}</td>
              )}
              <td className="py-2 text-gray-500">{new Date(r.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
