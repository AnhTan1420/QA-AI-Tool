'use client';

import { useEffect, useState } from 'react';
import { getPriorityStyle } from '@/lib/test-case-taxonomy';

type Snapshot = {
  code: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  preconditions?: string[];
  expected_result?: string;
  steps?: { step_number: number; action: string; expected_result: string }[];
};

type VersionEntry = {
  id: string;
  snapshot: Snapshot;
  edited_at: string;
  edited_by: string | null;
  profiles: { full_name: string | null } | null;
};

const DIFF_FIELDS: { key: keyof Snapshot; label: string }[] = [
  { key: 'title', label: 'Tiêu đề' },
  { key: 'category', label: 'Danh mục' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Trạng thái' },
  { key: 'expected_result', label: 'Kết quả mong đợi' },
];

function fieldValueToText(snapshot: Snapshot, key: keyof Snapshot): string {
  if (key === 'steps') return JSON.stringify(snapshot.steps ?? []);
  if (key === 'preconditions') return (snapshot.preconditions ?? []).join('; ');
  const value = snapshot[key];
  return value === undefined || value === null ? '' : String(value);
}

function diffSnapshots(older: Snapshot, newer: Snapshot) {
  const changes: { label: string; from: string; to: string }[] = [];
  for (const { key, label } of DIFF_FIELDS) {
    const from = fieldValueToText(older, key);
    const to = fieldValueToText(newer, key);
    if (from !== to) changes.push({ label, from, to });
  }
  const stepsFrom = JSON.stringify(older.steps ?? []);
  const stepsTo = JSON.stringify(newer.steps ?? []);
  if (stepsFrom !== stepsTo) {
    changes.push({ label: 'Các bước thực hiện', from: `${(older.steps ?? []).length} bước`, to: `${(newer.steps ?? []).length} bước` });
  }
  const preFrom = (older.preconditions ?? []).join('; ');
  const preTo = (newer.preconditions ?? []).join('; ');
  if (preFrom !== preTo) {
    changes.push({ label: 'Preconditions', from: preFrom || '(trống)', to: preTo || '(trống)' });
  }
  return changes;
}

export default function VersionHistory({ testCaseId, current }: { testCaseId: string; current: Snapshot }) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/test-cases/${testCaseId}/versions`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Không tải được lịch sử');
        if (!cancelled) setVersions(json.data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được lịch sử');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [testCaseId]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center gap-2">
        <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-700">Lịch sử chỉnh sửa</h3>
        {versions.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">{versions.length}</span>
        )}
      </div>

      {loading && <p className="text-sm text-gray-400">Đang tải...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && versions.length === 0 && (
        <p className="text-sm italic text-gray-400">Chưa có lần chỉnh sửa nào được ghi nhận.</p>
      )}

      {!loading && versions.length > 0 && (
        <ol className="space-y-3">
          {versions.map((entry, index) => {
            const newerState = index === 0 ? current : versions[index - 1].snapshot;
            const changes = diffSnapshots(entry.snapshot, newerState);
            const isExpanded = expandedId === entry.id;
            return (
              <li key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {entry.profiles?.full_name ?? 'Người dùng không xác định'}
                      <span className="ml-2 font-normal text-gray-400">
                        {new Date(entry.edited_at).toLocaleString('vi-VN')}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {changes.length > 0
                        ? `Đã thay đổi: ${changes.map((c) => c.label).join(', ')}`
                        : 'Không có thay đổi nội dung ghi nhận được'}
                    </p>
                  </div>
                  <svg
                    className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="mt-3 space-y-2 border-t border-gray-200 pt-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-blue-100 px-2 py-1 font-mono font-semibold text-blue-700">{entry.snapshot.code}</span>
                      <span className={`rounded px-2 py-1 font-semibold ${getPriorityStyle(entry.snapshot.priority)}`}>{entry.snapshot.priority}</span>
                      <span className="rounded bg-gray-100 px-2 py-1 text-gray-600">{entry.snapshot.status}</span>
                    </div>
                    {changes.length === 0 ? (
                      <p className="text-xs italic text-gray-400">Trạng thái test case tại thời điểm này giống hệt phiên bản mới hơn liền kề.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {changes.map((c, i) => (
                          <li key={i} className="text-xs">
                            <span className="font-semibold text-gray-700">{c.label}:</span>{' '}
                            <span className="text-red-500 line-through">{c.from || '(trống)'}</span>{' '}
                            <span className="text-gray-400">→</span>{' '}
                            <span className="text-emerald-700">{c.to || '(trống)'}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
