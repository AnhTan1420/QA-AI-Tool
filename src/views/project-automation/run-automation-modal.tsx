'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { useEnvironments } from '@/hooks/automation/use-environments';
import { useBatchAutomation, type BatchCredentials } from '@/hooks/automation/use-batch-automation';
import { BatchProgressPanel } from './batch-progress-panel';

export function RunAutomationModal({
  projectId,
  testCaseIds,
  onClose,
}: {
  projectId: string;
  testCaseIds: string[];
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const m = t.batchAutomation.runModal;

  const envState = useEnvironments(projectId);
  const automation = useBatchAutomation();

  const [environmentId, setEnvironmentId] = useState('');
  const [cookieToken, setCookieToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const selectedEnv = envState.environments.find((e) => e.id === environmentId) ?? null;

  function buildCredentials(): BatchCredentials {
    if (!selectedEnv) return {};
    if (selectedEnv.auth_mode === 'cookie') return { cookie_token: cookieToken };
    if (selectedEnv.auth_mode === 'login') return { login: { username, password } };
    return {};
  }

  async function handleStart() {
    if (!environmentId) return;
    await automation.start(projectId, testCaseIds, environmentId, buildCredentials());
  }

  function handleResume() {
    if (!automation.batch) return;
    automation.resume(automation.batch.id, buildCredentials());
  }

  const hasStarted = Boolean(automation.batch);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="surface-card w-full max-w-lg space-y-4 p-6">
        <div>
          <h2 className="text-h3">{m.title}</h2>
          <p className="text-body mt-1 text-sm">{m.subtitle(testCaseIds.length)}</p>
        </div>

        {!hasStarted ? (
          <>
            {!envState.loading && envState.environments.length === 0 ? (
              <div className="alert-info">
                {m.noEnvironments}{' '}
                <Link href={`/projects/${projectId}/automation/environments`} className="font-semibold underline">
                  {m.manageEnvironmentsLink}
                </Link>
              </div>
            ) : (
              <div>
                <label className="field-label">{m.environmentLabel}</label>
                <select
                  value={environmentId}
                  onChange={(ev) => setEnvironmentId(ev.target.value)}
                  className="field-input"
                >
                  <option value="">{m.environmentPlaceholder}</option>
                  {envState.environments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} — {e.target_url}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedEnv?.auth_mode === 'cookie' && (
              <div>
                <label className="field-label">{m.cookieLabel}</label>
                <textarea
                  value={cookieToken}
                  onChange={(ev) => setCookieToken(ev.target.value)}
                  placeholder={m.cookiePlaceholder}
                  rows={3}
                  className="field-input font-mono text-xs"
                />
              </div>
            )}

            {selectedEnv?.auth_mode === 'login' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="field-label">{m.usernameLabel}</label>
                  <input value={username} onChange={(ev) => setUsername(ev.target.value)} className="field-input" />
                </div>
                <div>
                  <label className="field-label">{m.passwordLabel}</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    className="field-input"
                  />
                </div>
              </div>
            )}
            {selectedEnv && selectedEnv.auth_mode !== 'none' && <p className="text-caption italic">{m.secretNote}</p>}

            {selectedEnv?.execution_mode === 'self_hosted' && (
              <div className="alert-info text-sm">{m.batchAlwaysServerlessNotice}</div>
            )}

            <p className="text-caption">{m.hobbyNotice}</p>

            {automation.error && <div className="alert-danger">{automation.error}</div>}

            <div className="flex items-center gap-3 border-t border-ink-100 pt-4">
              <button
                onClick={handleStart}
                disabled={!environmentId || automation.starting}
                className="btn-primary"
              >
                {automation.starting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {m.starting}
                  </>
                ) : (
                  m.startButton
                )}
              </button>
              <button onClick={onClose} className="btn-ghost">
                {m.cancelButton}
              </button>
            </div>
          </>
        ) : (
          <BatchProgressPanel automation={automation} onResume={handleResume} onClose={onClose} />
        )}
      </div>
    </div>
  );
}
