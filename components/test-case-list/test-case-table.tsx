'use client';

import Link from 'next/link';
import { getPriorityStyle, getAutomationStatusStyle } from '@/lib/test-case-taxonomy';
import { categoryBadge } from './use-test-case-list';
import type { TestCaseListState } from './use-test-case-list';

export function TestCaseTable({ list }: { list: TestCaseListState }) {
  const { t, projectId } = list;

  return (
    <table className="w-full text-sm">
      <thead className="bg-ink-50 font-medium text-ink-500">
        <tr>
          <th className="w-10 px-4 py-3">
            <input
              type="checkbox"
              checked={list.paginatedCases.length > 0 && list.paginatedCases.every((c) => list.selectedIds.has(c.id))}
              onChange={list.toggleSelectAll}
              className="rounded border-ink-300 text-brand-600 focus:ring-brand-300"
            />
          </th>
          <th className="px-6 py-3 text-left">{t.testCasesList.colCode}</th>
          <th className="px-6 py-3 text-left">{t.testCasesList.colTitle}</th>
          <th className="px-6 py-3 text-left">{t.testCasesList.colCategory}</th>
          <th className="px-6 py-3 text-left">{t.testCasesList.colPriority}</th>
          <th className="px-6 py-3 text-left">{t.testCasesList.colStatus}</th>
          <th className="px-6 py-3 text-left">{t.automation.badge.columnHeading}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink-100">
        {list.loading ? (
          <tr>
            <td colSpan={7} className="px-6 py-8 text-center text-ink-400">{t.testCasesList.loading}</td>
          </tr>
        ) : list.paginatedCases.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-6 py-8 text-center text-ink-400">{t.testCasesList.empty}</td>
          </tr>
        ) : (
          list.paginatedCases.map((tc) => (
            <tr key={tc.id} className={`transition-colors hover:bg-ink-50 ${list.selectedIds.has(tc.id) ? 'bg-brand-50/50' : ''}`}>
              <td className="px-4 py-4">
                <input
                  type="checkbox"
                  checked={list.selectedIds.has(tc.id)}
                  onChange={() => list.toggleSelect(tc.id)}
                  className="rounded border-ink-300 text-brand-600 focus:ring-brand-300"
                />
              </td>
              <td className="px-6 py-4">
                <Link href={`/projects/${projectId}/test-cases/${tc.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                  {tc.code}
                </Link>
              </td>
              <td className="px-6 py-4 font-medium text-ink-900">{tc.title}</td>
              <td className="px-6 py-4">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${categoryBadge(tc.category)}`}>
                  {tc.category}
                </span>
              </td>
              <td className="px-6 py-4">
                <span className={`rounded px-2 py-1 text-xs font-semibold ${getPriorityStyle(tc.priority)}`}>{tc.priority}</span>
              </td>
              <td className="px-6 py-4">
                <select
                  value={tc.status}
                  onChange={(e) => list.handleStatusChange(tc.id, e.target.value)}
                  className="field-input !w-auto !py-1.5 text-xs"
                >
                  <option value="draft">{t.testCasesList.statusDraft}</option>
                  <option value="in_review">{t.testCasesList.statusInReview}</option>
                  <option value="approved">{t.testCasesList.statusApproved}</option>
                </select>
              </td>
              <td className="px-6 py-4">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getAutomationStatusStyle(tc.automation_status)}`}>
                  {t.automation.badge.status[tc.automation_status ?? 'not_generated']}
                </span>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
