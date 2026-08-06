'use client';

import Link from 'next/link';
import { getPriorityStyle, getAutomationStatusStyle } from '@/lib/test-case-taxonomy';
import { categoryBadge } from './use-test-case-list';
import type { TestCaseListState } from './use-test-case-list';

export function TestCaseTable({ list }: { list: TestCaseListState }) {
  const { t, projectId } = list;

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-gray-500 font-medium">
        <tr>
          <th className="px-4 py-3 w-10">
            <input
              type="checkbox"
              checked={list.paginatedCases.length > 0 && list.paginatedCases.every((c) => list.selectedIds.has(c.id))}
              onChange={list.toggleSelectAll}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </th>
          <th className="text-left px-6 py-3">{t.testCasesList.colCode}</th>
          <th className="text-left px-6 py-3">{t.testCasesList.colTitle}</th>
          <th className="text-left px-6 py-3">{t.testCasesList.colCategory}</th>
          <th className="text-left px-6 py-3">{t.testCasesList.colPriority}</th>
          <th className="text-left px-6 py-3">{t.testCasesList.colStatus}</th>
          <th className="text-left px-6 py-3">{t.automation.badge.columnHeading}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {list.loading ? (
          <tr>
            <td colSpan={7} className="px-6 py-8 text-center text-gray-400">{t.testCasesList.loading}</td>
          </tr>
        ) : list.paginatedCases.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-6 py-8 text-center text-gray-400">{t.testCasesList.empty}</td>
          </tr>
        ) : (
          list.paginatedCases.map((tc) => (
            <tr key={tc.id} className={`hover:bg-gray-50 ${list.selectedIds.has(tc.id) ? 'bg-blue-50/50' : ''}`}>
              <td className="px-4 py-4">
                <input
                  type="checkbox"
                  checked={list.selectedIds.has(tc.id)}
                  onChange={() => list.toggleSelect(tc.id)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </td>
              <td className="px-6 py-4">
                <Link href={`/projects/${projectId}/test-cases/${tc.id}`} className="text-blue-600 font-medium hover:underline">
                  {tc.code}
                </Link>
              </td>
              <td className="px-6 py-4 text-gray-900">{tc.title}</td>
              <td className="px-6 py-4">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${categoryBadge(tc.category)}`}>
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
                  className="rounded-lg border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="draft">{t.testCasesList.statusDraft}</option>
                  <option value="in_review">{t.testCasesList.statusInReview}</option>
                  <option value="approved">{t.testCasesList.statusApproved}</option>
                </select>
              </td>
              <td className="px-6 py-4">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getAutomationStatusStyle(tc.automation_status)}`}>
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
