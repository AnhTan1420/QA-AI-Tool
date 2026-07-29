'use client';

import { use, useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';

type Member = {
  user_id: string;
  role: 'qa' | 'senior_qa' | 'admin';
  joined_at: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

export default function TeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { t, locale } = useLanguage();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Member['role']>('qa');
  const [isInviting, setIsInviting] = useState(false);

  async function loadMembers() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/members`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t.team.errors.loadFailed);
      setMembers(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.team.errors.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (projectId !== 'demo') loadMembers();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    setIsInviting(true);
    setError('');
    try {
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t.team.errors.inviteFailed);
      setEmail('');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.team.errors.inviteFailed);
    } finally {
      setIsInviting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">{t.team.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950">{t.team.title}</h1>
        <p className="mt-2 text-slate-600">{t.team.subtitle}</p>
      </div>

      {projectId === 'demo' ? (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm font-semibold text-amber-800">
          {t.team.demoNotice}
        </div>
      ) : (
        <>
          <form onSubmit={inviteMember} className="flex flex-wrap items-end gap-3 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <label className="flex-1 min-w-56">
              <span className="text-sm font-bold text-slate-700">{t.team.emailLabel}</span>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3" placeholder="teammate@example.com" />
            </label>
            <label>
              <span className="text-sm font-bold text-slate-700">{t.team.roleLabel}</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Member['role'])} className="mt-2 rounded-xl border border-slate-200 px-4 py-3">
                <option value="qa">qa</option>
                <option value="senior_qa">senior_qa</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <button type="submit" disabled={isInviting} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              {isInviting ? t.team.inviting : t.team.inviteButton}
            </button>
          </form>

          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div>}

          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            {loading && <div className="p-8 text-center text-slate-500">{t.team.loading}</div>}
            {!loading && members.length === 0 && <div className="p-8 text-center text-slate-500">{t.team.empty}</div>}
            {members.map((member) => (
              <div key={member.user_id} className="flex items-center justify-between border-b border-slate-100 px-6 py-4 last:border-b-0">
                <div>
                  <p className="font-bold text-slate-950">{member.profiles?.full_name ?? member.user_id}</p>
                  <p className="text-xs text-slate-500">{t.team.joinedPrefix} {new Date(member.joined_at).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US')}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold text-slate-700">{member.role}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
