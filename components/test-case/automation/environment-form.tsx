'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

export function EnvironmentForm({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const e = t.automation.environment;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-700">{e.heading}</h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">{e.browser}</label>
          <select
            value={automation.browser}
            onChange={(ev) => automation.setBrowser(ev.target.value as any)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="chromium">{e.browserOptions.chromium}</option>
            <option value="firefox">{e.browserOptions.firefox}</option>
            <option value="edge">{e.browserOptions.edge}</option>
          </select>
          <p className="mt-1 text-xs text-gray-400">
            {automation.browser === 'edge' ? e.browserEdgeNote : e.browserServerlessNote}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-600">{e.targetUrl}</label>
          <input
            type="url"
            value={automation.targetUrl}
            onChange={(ev) => automation.setTargetUrl(ev.target.value)}
            placeholder={e.targetUrlPlaceholder}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-xs font-semibold text-gray-600">{e.authMode}</label>
        <div className="flex flex-wrap gap-2">
          {(['none', 'cookie', 'login'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => automation.setAuthMode(mode)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                automation.authMode === mode
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {mode === 'none' ? e.authNone : mode === 'cookie' ? e.authCookie : e.authLogin}
            </button>
          ))}
        </div>

        {automation.authMode === 'cookie' && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold text-gray-600">{e.cookieLabel}</label>
            <textarea
              value={automation.cookieToken}
              onChange={(ev) => automation.setCookieToken(ev.target.value)}
              placeholder={e.cookiePlaceholder}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400">{e.cookieHelp}</p>
          </div>
        )}

        {automation.authMode === 'login' && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">{e.usernameLabel}</label>
              <input
                type="text"
                value={automation.username}
                onChange={(ev) => automation.setUsername(ev.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-600">{e.passwordLabel}</label>
              <input
                type="password"
                value={automation.password}
                onChange={(ev) => automation.setPassword(ev.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {automation.authMode !== 'none' && <p className="mt-2 text-xs italic text-gray-400">{e.secretNote}</p>}
      </div>

      <div className="mt-4 border-t border-gray-100 pt-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
          <input
            type="checkbox"
            checked={automation.crawlEnabled}
            onChange={(ev) => automation.setCrawlEnabled(ev.target.checked)}
            className="h-4 w-4 rounded border-gray-300"
          />
          {e.crawlLabel}
        </label>
        <p className="mt-1 text-xs text-gray-400">{e.crawlHelp}</p>
        {automation.crawlEnabled && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-gray-600">{e.crawlMaxPagesLabel}</label>
            <input
              type="number"
              min={1}
              max={20}
              value={automation.crawlMaxPages}
              onChange={(ev) => automation.setCrawlMaxPages(Number(ev.target.value))}
              className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={automation.inspect}
          disabled={automation.inspecting || !automation.targetUrl}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
        >
          {automation.inspecting ? e.inspecting : e.inspectButton}
        </button>
        {automation.elementMap.length > 0 && (
          <span className="text-xs font-semibold text-emerald-700">{e.inspectSuccess(automation.elementMap.length)}</span>
        )}
      </div>
      {automation.inspectError && <p className="mt-2 text-xs font-semibold text-red-600">{automation.inspectError}</p>}
    </div>
  );
}
