'use client';

import { useState } from 'react';
import {
  Settings2, Unlock, Cookie, KeyRound, Lock, Eye, EyeOff, ChevronDown, ChevronUp,
  Plus, ArrowUp, ArrowDown, X, ScanSearch, CircleCheck, Loader2,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { useAutomation } from '@/hooks/test-case/use-automation';

/**
 * Environment & credential configuration panel.
 *
 * UX improvements over the original:
 * - Cookie section has a "Paste from DevTools" helper button with step-by-step guidance
 * - Login section has a "Show password" toggle
 * - Auth mode selection uses clearer radio-style cards with icons
 * - Cookie format help is shown inline with an expandable example
 * - Secret fields display a "Never stored" badge for trust
 * - Inspection steps are collapsed by default with a toggle to expand
 */
export function EnvironmentForm({ automation }: { automation: ReturnType<typeof useAutomation> }) {
  const { t } = useLanguage();
  const e = t.automation.environment;
  const [showPassword, setShowPassword] = useState(false);
  const [cookieHelpExpanded, setCookieHelpExpanded] = useState(false);
  const [inspectionStepsOpen, setInspectionStepsOpen] = useState(false);

  return (
    <div className="surface-card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="panel-icon">
          <Settings2 className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <h3 className="text-h3">{e.heading}</h3>
      </div>

      {/* Saved environments quick-select */}
      {automation.savedEnvironments.length > 0 && (
        <div className="mb-5">
          <label className="field-label">{e.savedEnvironmentLabel}</label>
          <select
            value={automation.selectedEnvironmentId}
            onChange={(ev) => automation.applySavedEnvironment(ev.target.value)}
            className="field-input"
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
          <label className="field-label">{e.browser}</label>
          <select
            value={automation.browser}
            onChange={(ev) => automation.setBrowser(ev.target.value as any)}
            className="field-input"
          >
            <option value="chromium">{e.browserOptions.chromium}</option>
            <option value="firefox">{e.browserOptions.firefox}</option>
            <option value="edge">{e.browserOptions.edge}</option>
          </select>
          <p className="mt-1.5 text-caption">
            {automation.browser === 'edge' ? e.browserEdgeNote : e.browserServerlessNote}
          </p>
        </div>

        <div>
          <label className="field-label">{e.targetUrl}</label>
          <input
            type="url"
            value={automation.targetUrl}
            onChange={(ev) => automation.setTargetUrl(ev.target.value)}
            placeholder={e.targetUrlPlaceholder}
            className="field-input"
          />
        </div>
      </div>

      {/* Authentication mode — card-style selection */}
      <div className="mt-5">
        <label className="field-label">{e.authMode}</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {([
            { mode: 'none' as const, Icon: Unlock, label: e.authNone, desc: 'Public pages' },
            { mode: 'cookie' as const, Icon: Cookie, label: e.authCookie, desc: 'Copy from DevTools' },
            { mode: 'login' as const, Icon: KeyRound, label: e.authLogin, desc: 'Username + password' },
          ]).map(({ mode, Icon, label, desc }) => (
            <button
              key={mode}
              type="button"
              onClick={() => automation.setAuthMode(mode)}
              className={`rounded-[var(--radius-control)] border p-3 text-left transition-all duration-150 ${
                automation.authMode === mode
                  ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400'
                  : 'border-ink-200 hover:border-ink-300 hover:bg-ink-50'
              }`}
            >
              <Icon className={`h-4.5 w-4.5 ${automation.authMode === mode ? 'text-brand-600' : 'text-ink-400'}`} strokeWidth={2.25} />
              <div className="mt-1.5 text-xs font-semibold text-ink-800">{label}</div>
              <div className="mt-0.5 text-[11px] text-ink-400">{desc}</div>
            </button>
          ))}
        </div>

        {/* Cookie section */}
        {automation.authMode === 'cookie' && (
          <div className="mt-4 rounded-[var(--radius-control)] border border-ink-200 bg-ink-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <Cookie className="h-3.5 w-3.5" /> {e.cookieLabel}
              </label>
              <span className="badge-success">
                <Lock className="h-3 w-3" /> Never stored
              </span>
            </div>

            <textarea
              value={automation.cookieToken}
              onChange={(ev) => automation.setCookieToken(ev.target.value)}
              placeholder='Paste cookie value, "name=value; name2=value2" header string, OR JSON array: [{"name":"session","value":"abc..."}]'
              rows={4}
              className="field-input font-mono text-xs !py-2"
            />

            <button
              type="button"
              onClick={() => setCookieHelpExpanded(!cookieHelpExpanded)}
              className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              {cookieHelpExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              How to copy cookies from Chrome DevTools
            </button>

            {cookieHelpExpanded && (
              <div className="mt-3 space-y-2 rounded-[var(--radius-control)] border border-ink-200 bg-white p-4 text-xs text-ink-600">
                <p className="font-semibold text-ink-800">Step-by-step (Chrome):</p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Open your app in Chrome and <strong>log in manually</strong></li>
                  <li>Press <kbd className="rounded border border-ink-200 bg-ink-100 px-1">F12</kbd> to open DevTools</li>
                  <li>Go to <strong>Application</strong> tab → <strong>Cookies</strong> → your site</li>
                  <li>
                    <strong>Single cookie:</strong> click the cookie row, copy the <strong>Value</strong> field only
                  </li>
                  <li>
                    <strong>Multiple cookies</strong> (e.g. Google): right-click → &quot;Copy all as JSON&quot; or use the Console:
                    <pre className="mt-1.5 overflow-x-auto rounded-[var(--radius-control)] bg-ink-100 p-2 text-[10px]">
{`// Paste this in the Console tab:
copy(JSON.stringify(document.cookie.split('; ').map(c => {
  const [name, ...v] = c.split('=');
  return { name, value: v.join('=') };
})))`}
                    </pre>
                  </li>
                </ol>
                <p className="text-[11px] text-ink-400">
                  Supported formats: plain value (injected as &quot;session&quot; cookie), a
                  <code className="mx-1 rounded bg-ink-100 px-1">name=value; name2=value2</code>
                  header string, or JSON array
                  <code className="mx-1 rounded bg-ink-100 px-1">[&#123;&quot;name&quot;:&quot;SID&quot;,&quot;value&quot;:&quot;...&quot;&#125;]</code>
                </p>
              </div>
            )}
          </div>
        )}

        {/* Login section */}
        {automation.authMode === 'login' && (
          <div className="mt-4 rounded-[var(--radius-control)] border border-ink-200 bg-ink-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                <KeyRound className="h-3.5 w-3.5" /> Login Credentials
              </p>
              <span className="badge-success">
                <Lock className="h-3 w-3" /> Never stored
              </span>
            </div>

            <div className="mb-4 rounded-[var(--radius-control)] border border-warning-600/25 bg-warning-50 p-3">
              <p className="text-xs text-warning-600">
                <strong>When to use:</strong> Your app has a standard login form (email/password or username/password).
                The automation will fill the form and click Submit automatically.
              </p>
              <p className="mt-1.5 text-xs text-warning-600/90">
                <strong>Limitation:</strong> Works best with simple login forms. For apps with OAuth, CAPTCHA,
                2FA, or custom login widgets, use <strong>Cookie auth</strong> instead (log in manually once, then copy cookies).
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label !mb-1 !text-xs">{e.usernameLabel}</label>
                <input
                  type="text"
                  value={automation.username}
                  autoComplete="off"
                  onChange={(ev) => automation.setUsername(ev.target.value)}
                  placeholder="user@example.com"
                  className="field-input !py-2 text-sm"
                />
              </div>
              <div>
                <label className="field-label !mb-1 !text-xs">{e.passwordLabel}</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={automation.password}
                    autoComplete="new-password"
                    onChange={(ev) => automation.setPassword(ev.target.value)}
                    className="field-input !py-2 pr-10 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-400 hover:text-ink-600"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {automation.authMode !== 'none' && (
          <p className="mt-2 text-caption italic">{e.secretNote}</p>
        )}
      </div>

      {/* Multi-step inspection — collapsible */}
      <div className="mt-5 border-t border-ink-100 pt-4">
        <button
          type="button"
          onClick={() => setInspectionStepsOpen(!inspectionStepsOpen)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <p className="text-xs font-semibold text-ink-600">{e.inspectionSteps.heading}</p>
            <p className="mt-0.5 text-caption">{e.inspectionSteps.help}</p>
          </div>
          <span className="ml-4 flex shrink-0 items-center gap-1 text-caption">
            {automation.inspectionSteps.length > 0
              ? `${automation.inspectionSteps.length} step(s) configured`
              : 'optional'}
            {inspectionStepsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>

        {inspectionStepsOpen && (
          <div className="mt-3">
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={automation.addInspectionStep}
                disabled={automation.inspectionSteps.length >= 10}
                className="btn-secondary btn-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                {e.inspectionSteps.addButton}
              </button>
            </div>

            {automation.inspectionSteps.length > 0 && (
              <ol className="space-y-3">
                {automation.inspectionSteps.map((step, idx) => (
                  <li key={step.id} className="rounded-[var(--radius-control)] border border-ink-100 bg-ink-50/60 p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 shrink-0 text-xs font-bold text-ink-400">#{idx + 1}</span>
                      <div className="grid flex-1 gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          value={step.label}
                          onChange={(ev) => automation.updateInspectionStep(step.id, { label: ev.target.value })}
                          placeholder={e.inspectionSteps.labelPlaceholder}
                          className="field-input !py-1.5 text-xs"
                        />
                        <select
                          value={step.action}
                          onChange={(ev) => automation.updateInspectionStep(step.id, { action: ev.target.value as any })}
                          className="field-input !py-1.5 text-xs"
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
                            className="field-input !py-1.5 font-mono text-xs sm:col-span-2"
                          />
                        ) : (
                          <input
                            type="text"
                            value={step.selector}
                            onChange={(ev) => automation.updateInspectionStep(step.id, { selector: ev.target.value })}
                            placeholder={e.inspectionSteps.selectorPlaceholder}
                            className={`field-input !py-1.5 font-mono text-xs ${step.action === 'fill' ? '' : 'sm:col-span-2'}`}
                          />
                        )}
                        {step.action === 'fill' && (
                          <input
                            type="text"
                            value={step.value}
                            onChange={(ev) => automation.updateInspectionStep(step.id, { value: ev.target.value })}
                            placeholder={e.inspectionSteps.valuePlaceholder}
                            className="field-input !py-1.5 text-xs"
                          />
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => automation.moveInspectionStep(step.id, -1)}
                          disabled={idx === 0}
                          className="icon-btn h-6 w-6"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => automation.moveInspectionStep(step.id, 1)}
                          disabled={idx === automation.inspectionSteps.length - 1}
                          className="icon-btn h-6 w-6"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => automation.removeInspectionStep(step.id)}
                          className="icon-btn h-6 w-6 !text-danger-500 hover:!bg-danger-50"
                        >
                          <X className="h-3 w-3" />
                        </button>
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
      <div className="mt-4 border-t border-ink-100 pt-4">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink-600">
          <input
            type="checkbox"
            checked={automation.crawlEnabled}
            onChange={(ev) => automation.setCrawlEnabled(ev.target.checked)}
            className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
          />
          {e.crawlLabel}
        </label>
        <p className="mt-1 text-caption">{e.crawlHelp}</p>
        {automation.crawlEnabled && (
          <div className="mt-2 flex items-center gap-2">
            <label className="text-xs text-ink-600">{e.crawlMaxPagesLabel}</label>
            <input
              type="number"
              min={1}
              max={20}
              value={automation.crawlMaxPages}
              onChange={(ev) => automation.setCrawlMaxPages(Number(ev.target.value))}
              className="field-input w-20 !py-1.5 text-sm"
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
          className="btn-primary !bg-ink-800 hover:!bg-ink-900 focus-visible:!ring-ink-400"
        >
          {automation.inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
          {automation.inspecting ? e.inspecting : e.inspectButton}
        </button>
        {automation.elementMap.length > 0 && (
          <span className="flex items-center gap-1 text-xs font-semibold text-success-600">
            <CircleCheck className="h-3.5 w-3.5" /> {e.inspectSuccess(automation.elementMap.length)}
          </span>
        )}
        {!automation.targetUrl && (
          <span className="text-caption">Enter a Target URL first</span>
        )}
      </div>
      {automation.inspectError && (
        <div className="mt-2 alert-danger !p-3">
          <p className="text-xs font-semibold">{automation.inspectError}</p>
          {automation.inspectError.includes('resolve') && (
            <p className="mt-1 text-xs opacity-90">
              Tip: Make sure the URL is publicly reachable. Private/localhost URLs are blocked for security.
            </p>
          )}
          {automation.inspectError.includes('login') && (
            <p className="mt-1 text-xs opacity-90">
              Tip: If the login form wasn&apos;t found, try using <strong>Cookie auth</strong> instead — log in manually and copy your session cookies.
            </p>
          )}
        </div>
      )}
      {automation.inspectWarnings.length > 0 && (
        <div className="mt-3 rounded-[var(--radius-control)] border border-warning-600/20 bg-warning-50 p-3">
          <p className="mb-1 text-xs font-bold text-warning-600">{e.inspectWarningsHeading}</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs text-warning-600/90">
            {automation.inspectWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
