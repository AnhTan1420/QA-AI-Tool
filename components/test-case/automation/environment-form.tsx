'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from './use-automation';

/**
 * Environment & credential configuration panel.
 *
 * UX improvements over the original:
 * - Cookie section has a "Paste from DevTools" helper button with step-by-step guidance
 * - Login section has a "Show password" toggle
 * - Auth mode selection uses clearer radio-style cards with icons
 * - Cookie format help is shown inline with an expandable example
 * - Secret fields display a "🔒 Never stored" badge for trust
 * - Inspection steps are collapsed by default with a toggle to expand
 */
export function EnvironmentForm({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const e = t.automation.environment;
  const [showPassword, setShowPassword] = useState(false);
  const [cookieHelpExpanded, setCookieHelpExpanded] = useState(false);
  const [inspectionStepsOpen, setInspectionStepsOpen] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-700">{e.heading}</h3>

      {/* Saved environments quick-select */}
      {automation.savedEnvironments.length > 0 && (
        <div className="mb-5">
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

      {/* Browser + Target URL */}
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

      {/* Authentication mode — card-style selection */}
      <div className="mt-5">
        <label className="mb-2 block text-xs font-semibold text-gray-600">{e.authMode}</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            { mode: 'none' as const, icon: '🔓', label: e.authNone, desc: 'Public pages' },
            { mode: 'cookie' as const, icon: '🍪', label: e.authCookie, desc: 'Copy from DevTools' },
            { mode: 'login' as const, icon: '🔑', label: e.authLogin, desc: 'Username + password' },
          ]).map(({ mode, icon, label, desc }) => (
            <button
              key={mode}
              type="button"
              onClick={() => automation.setAuthMode(mode)}
              className={`rounded-xl border p-3 text-left transition ${
                automation.authMode === mode
                  ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-lg leading-none">{icon}</div>
              <div className="mt-1 text-xs font-semibold text-gray-800">{label}</div>
              <div className="mt-0.5 text-[11px] text-gray-400">{desc}</div>
            </button>
          ))}
        </div>

        {/* Cookie section */}
        {automation.authMode === 'cookie' && (
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700">🍪 {e.cookieLabel}</label>
              <span className="text-[11px] bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-semibold">
                🔒 Never stored
              </span>
            </div>

            <textarea
              value={automation.cookieToken}
              onChange={(ev) => automation.setCookieToken(ev.target.value)}
              placeholder='Paste cookie value OR JSON array: [{"name":"session","value":"abc..."}]'
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            <button
              type="button"
              onClick={() => setCookieHelpExpanded(!cookieHelpExpanded)}
              className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              {cookieHelpExpanded ? '▲' : '▼'} How to copy cookies from Chrome DevTools
            </button>

            {cookieHelpExpanded && (
              <div className="mt-3 rounded-lg bg-white border border-gray-200 p-4 text-xs text-gray-600 space-y-2">
                <p className="font-semibold text-gray-800">Step-by-step (Chrome):</p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Open your app in Chrome and <strong>log in manually</strong></li>
                  <li>Press <kbd className="bg-gray-100 border rounded px-1">F12</kbd> to open DevTools</li>
                  <li>Go to <strong>Application</strong> tab → <strong>Cookies</strong> → your site</li>
                  <li>
                    <strong>Single cookie:</strong> click the cookie row, copy the <strong>Value</strong> field only
                  </li>
                  <li>
                    <strong>Multiple cookies</strong> (e.g. Google): right-click → &quot;Copy all as JSON&quot; or use the Console:
                    <pre className="mt-1.5 bg-gray-100 rounded p-2 overflow-x-auto text-[10px]">
{`// Paste this in the Console tab:
copy(JSON.stringify(document.cookie.split('; ').map(c => {
  const [name, ...v] = c.split('=');
  return { name, value: v.join('=') };
})))`}
                    </pre>
                  </li>
                </ol>
                <p className="text-gray-400 text-[11px]">
                  Supported formats: plain value (injected as &quot;session&quot; cookie), or JSON array
                  <code className="bg-gray-100 rounded px-1 mx-1">[&#123;&quot;name&quot;:&quot;SID&quot;,&quot;value&quot;:&quot;...&quot;&#125;]</code>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Login section */}
        {automation.authMode === 'login' && (
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-700">🔑 Login Credentials</p>
              <span className="text-[11px] bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5 font-semibold">
                🔒 Never stored
              </span>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 mb-4">
              <p className="text-xs text-amber-800">
                <strong>When to use:</strong> Your app has a standard login form (email/password or username/password).
                The automation will fill the form and click Submit automatically.
              </p>
              <p className="mt-1.5 text-xs text-amber-700">
                <strong>Limitation:</strong> Works best with simple login forms. For apps with OAuth, CAPTCHA,
                2FA, or custom login widgets, use <strong>Cookie auth</strong> instead (log in manually once, then copy cookies).
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">{e.usernameLabel}</label>
                <input
                  type="text"
                  value={automation.username}
                  autoComplete="off"
                  onChange={(ev) => automation.setUsername(ev.target.value)}
                  placeholder="user@example.com"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-600">{e.passwordLabel}</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={automation.password}
                    autoComplete="new-password"
                    onChange={(ev) => automation.setPassword(ev.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                    tabIndex={-1}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {automation.authMode !== 'none' && (
          <p className="mt-2 text-xs italic text-gray-400">{e.secretNote}</p>
        )}
      </div>

      {/* Multi-step inspection — collapsible */}
      <div className="mt-5 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={() => setInspectionStepsOpen(!inspectionStepsOpen)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <p className="text-xs font-semibold text-gray-600">{e.inspectionSteps.heading}</p>
            <p className="mt-0.5 text-xs text-gray-400">{e.inspectionSteps.help}</p>
          </div>
          <span className="text-xs text-gray-400 shrink-0 ml-4">
            {automation.inspectionSteps.length > 0
              ? `${automation.inspectionSteps.length} step(s) configured`
              : 'optional'}
            {' '}{inspectionStepsOpen ? '▲' : '▼'}
          </span>
        </button>

        {inspectionStepsOpen && (
          <div className="mt-3">
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={automation.addInspectionStep}
                disabled={automation.inspectionSteps.length >= 10}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {e.inspectionSteps.addButton}
              </button>
            </div>

            {automation.inspectionSteps.length > 0 && (
              <ol className="space-y-3">
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
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        >↑</button>
                        <button
                          type="button"
                          onClick={() => automation.moveInspectionStep(step.id, 1)}
                          disabled={idx === automation.inspectionSteps.length - 1}
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                        >↓</button>
                        <button
                          type="button"
                          onClick={() => automation.removeInspectionStep(step.id)}
                          className="rounded border border-red-200 px-1.5 py-0.5 text-xs text-red-500 hover:bg-red-50"
                        >✕</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      {/* Crawl option */}
      <div className="mt-4 border-t border-gray-100 pt-4">
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 cursor-pointer">
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

      {/* Inspect button */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={automation.inspect}
          disabled={automation.inspecting || !automation.targetUrl}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
        >
          {automation.inspecting ? e.inspecting : e.inspectButton}
        </button>
        {automation.elementMap.length > 0 && (
          <span className="text-xs font-semibold text-emerald-700">
            ✓ {e.inspectSuccess(automation.elementMap.length)}
          </span>
        )}
        {!automation.targetUrl && (
          <span className="text-xs text-gray-400">Enter a Target URL first</span>
        )}
      </div>
      {automation.inspectError && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-semibold text-red-700">{automation.inspectError}</p>
          {automation.inspectError.includes('resolve') && (
            <p className="mt-1 text-xs text-red-600">
              Tip: Make sure the URL is publicly reachable. Private/localhost URLs are blocked for security.
            </p>
          )}
          {automation.inspectError.includes('login') && (
            <p className="mt-1 text-xs text-red-600">
              Tip: If the login form wasn&apos;t found, try using <strong>Cookie auth</strong> instead — log in manually and copy your session cookies.
            </p>
          )}
        </div>
      )}
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
