'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

export function EnvironmentForm({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const e = t.automation.environment;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-700">{e.heading}</h3>

      {automation.savedEnvironments.length > 0 && (
        <div className="mb-4">
          <label className="mb-1 block text-xs font-semibold text-gray-600">{e.savedEnvironmentLabel}</label>
          <select
            value={automation.selectedEnvironmentId}
            onChange={(ev) => automation.applySavedEnvironment(ev.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{e.savedEnvironmentPlaceholder}</option>
            {automation.savedEnvironments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name} — {env.target_url}
              </option>
            ))}
          </select>
        </div>
      )}

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
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-600">{e.inspectionSteps.heading}</p>
            <p className="mt-1 text-xs text-gray-400">{e.inspectionSteps.help}</p>
          </div>
          <button
            type="button"
            onClick={automation.addInspectionStep}
            disabled={automation.inspectionSteps.length >= 10}
            className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {e.inspectionSteps.addButton}
          </button>
        </div>

        {automation.inspectionSteps.length > 0 && (
          <ol className="mt-3 space-y-3">
            {automation.inspectionSteps.map((step, idx) => (
              <li key={step.id} className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-2 shrink-0 text-xs font-bold text-gray-400">#{idx + 1}</span>
                  <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <input
                      type="text"
                      value={step.label}
                      onChange={(ev) => automation.updateInspectionStep(step.id, { label: ev.target.value })}
                      placeholder={e.inspectionSteps.labelPlaceholder}
                      className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select
                      value={step.action}
                      onChange={(ev) => automation.updateInspectionStep(step.id, { action: ev.target.value as any })}
                      className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="click">{e.inspectionSteps.actionOptions.click}</option>
                      <option value="fill">{e.inspectionSteps.actionOptions.fill}</option>
                      <option value="press_enter">{e.inspectionSteps.actionOptions.press_enter}</option>
                      <option value="goto">{e.inspectionSteps.actionOptions.goto}</option>
                    </select>

                    {step.action === 'goto' ? (
                      <input
                        type="url"
                        value={step.url}
                        onChange={(ev) => automation.updateInspectionStep(step.id, { url: ev.target.value })}
                        placeholder={e.inspectionSteps.urlPlaceholder}
                        className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 sm:col-span-2"
                      />
                    ) : (
                      <input
                        type="text"
                        value={step.selector}
                        onChange={(ev) => automation.updateInspectionStep(step.id, { selector: ev.target.value })}
                        placeholder={e.inspectionSteps.selectorPlaceholder}
                        className={`w-full rounded-lg border border-gray-300 px-2.5 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          step.action === 'fill' ? '' : 'sm:col-span-2'
                        }`}
                      />
                    )}
                    {step.action === 'fill' && (
                      <input
                        type="text"
                        value={step.value}
                        onChange={(ev) => automation.updateInspectionStep(step.id, { value: ev.target.value })}
                        placeholder={e.inspectionSteps.valuePlaceholder}
                        className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => automation.moveInspectionStep(step.id, -1)}
                      disabled={idx === 0}
                      title={e.inspectionSteps.moveUp}
                      className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => automation.moveInspectionStep(step.id, 1)}
                      disabled={idx === automation.inspectionSteps.length - 1}
                      title={e.inspectionSteps.moveDown}
                      className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => automation.removeInspectionStep(step.id)}
                      title={e.inspectionSteps.removeButton}
                      className="rounded border border-red-200 px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
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
      {automation.inspectWarnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-bold text-amber-800">{e.inspectWarningsHeading}</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs text-amber-700">
            {automation.inspectWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
