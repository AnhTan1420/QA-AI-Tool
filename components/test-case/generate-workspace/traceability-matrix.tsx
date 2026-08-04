'use client';

import { useMemo, useState } from 'react';
import type { TraceabilityMatrixRow } from '@/lib/documents/coverage';
import type { Dictionary } from '@/lib/i18n/dictionaries/vi';
import { SCROLLBAR } from './shared';

const ATOM_TYPE_LABELS: Record<string, string> = {
  rule: 'Rule',
  field: 'Field',
  screen_element: 'UI Element',
  entity: 'Entity',
  entity_field: 'Entity Field',
  relationship: 'Relationship',
  flow_step: 'Flow Step',
  state: 'State',
  condition: 'Condition',
};

/**
 * Bang chi tiet "atom trong tai lieu ↔ test case nao dang cover no" — khac voi
 * banner coverage % + list uncovered da co truoc day (chi cho biet BAO NHIEU
 * atom bi bo sot), bang nay cho QA lead THAY DUNG atom X dang duoc case nao
 * dam nhiem, phuc vu audit ("case nay co dang cover dung yeu cau khong?", "rule
 * nay co dang bi 2-3 case lam trung lap khong?").
 */
export function TraceabilityMatrix({ matrix, t }: { matrix: TraceabilityMatrixRow[]; t: Dictionary }) {
  const [query, setQuery] = useState('');
  const [onlyUncovered, setOnlyUncovered] = useState(false);
  const tm = t.generateWorkspace.traceabilityMatrix;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matrix.filter((row) => {
      if (onlyUncovered && row.covered_by.length > 0) return false;
      if (!q) return true;
      return (
        row.atom_id.toLowerCase().includes(q) ||
        row.label.toLowerCase().includes(q) ||
        row.covered_by.some((c) => c.code.toLowerCase().includes(q))
      );
    });
  }, [matrix, query, onlyUncovered]);

  return (
    <div className="mt-3 rounded-2xl border border-slate-100 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tm.searchPlaceholder}
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs outline-none focus:border-blue-300"
        />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <input type="checkbox" checked={onlyUncovered} onChange={(e) => setOnlyUncovered(e.target.checked)} />
          {tm.onlyUncovered}
        </label>
        <span className="text-xs text-slate-400">{filtered.length}/{matrix.length} {tm.atomsSuffix}</span>
      </div>

      <div className={`max-h-80 overflow-y-auto ${SCROLLBAR}`}>
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">{tm.colAtom}</th>
              <th className="px-3 py-2">{tm.colType}</th>
              <th className="px-3 py-2">{tm.colContent}</th>
              <th className="px-3 py-2">{tm.colCoveredBy}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.atom_id} className="border-t border-slate-50">
                <td className="px-3 py-2 font-mono text-indigo-600">{row.atom_id}</td>
                <td className="px-3 py-2 text-slate-500">{ATOM_TYPE_LABELS[row.atom_type] ?? row.atom_type}</td>
                <td className="px-3 py-2 text-slate-700">
                  {row.label}
                  {row.screen_or_section && <span className="ml-1 text-slate-400">({row.screen_or_section})</span>}
                </td>
                <td className="px-3 py-2">
                  {row.covered_by.length === 0 ? (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 font-bold text-amber-600">{tm.notCovered}</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.covered_by.map((c, i) => (
                        <span key={i} className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono font-bold text-emerald-700" title={c.title}>
                          {c.code}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">{tm.noMatch}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
