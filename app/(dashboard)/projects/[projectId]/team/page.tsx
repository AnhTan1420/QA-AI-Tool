'use client';

import { use, useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  X,
  Search,
  ShieldCheck,
  Users,
  Trash2,
  ChevronDown,
  Loader2,
  Mail,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { createClient } from '@/lib/supabase/client';

type Role = 'qa' | 'admin';

type Member = {
  user_id: string;
  role: Role;
  joined_at: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function TeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { t, locale } = useLanguage();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('qa');
  const [isInviting, setIsInviting] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [roleUpdateError, setRoleUpdateError] = useState<Record<string, string>>({});

  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<Record<string, string>>({});

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
    if (projectId === 'demo') {
      setLoading(false);
      return;
    }
    loadMembers();
    createClient()
      .auth.getUser()
      .then(({ data }) => setCurrentUserId(data.user?.id ?? null))
      .catch(() => setCurrentUserId(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const currentMember = useMemo(
    () => members.find((m) => m.user_id === currentUserId) ?? null,
    [members, currentUserId]
  );
  const isAdmin = currentMember?.role === 'admin';
  const adminCount = useMemo(() => members.filter((m) => m.role === 'admin').length, [members]);
  const qaCount = members.length - adminCount;

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => (m.profiles?.full_name ?? m.user_id).toLowerCase().includes(q));
  }, [members, search]);

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
      setRole('qa');
      setShowInviteForm(false);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.team.errors.inviteFailed);
    } finally {
      setIsInviting(false);
    }
  }

  async function updateMemberRole(userId: string, newRole: Role) {
    setEditingUserId(null);
    setRoleUpdateError((prev) => ({ ...prev, [userId]: '' }));
    // Cập nhật lạc quan để UI phản hồi ngay, revert nếu API lỗi.
    const previous = members;
    setMembers((current) => current.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m)));
    try {
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, role: newRole }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t.team.errors.updateRoleFailed);
    } catch (err) {
      setMembers(previous);
      setRoleUpdateError((prev) => ({ ...prev, [userId]: err instanceof Error ? err.message : t.team.errors.updateRoleFailed }));
    }
  }

  async function removeMember(userId: string) {
    setIsRemoving(true);
    setRemoveError((prev) => ({ ...prev, [userId]: '' }));
    const previous = members;
    setMembers((current) => current.filter((m) => m.user_id !== userId));
    try {
      const response = await fetch(`/api/projects/${projectId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error ?? t.team.errors.removeFailed);
      setRemovingUserId(null);
    } catch (err) {
      setMembers(previous);
      setRemoveError((prev) => ({ ...prev, [userId]: err instanceof Error ? err.message : t.team.errors.removeFailed }));
    } finally {
      setIsRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow">{t.team.eyebrow}</p>
          <h1 className="text-h1 mt-2">{t.team.title}</h1>
          <p className="text-body mt-2 max-w-2xl">{t.team.subtitle}</p>
        </div>

        {projectId !== 'demo' && isAdmin && (
          <button onClick={() => setShowInviteForm((v) => !v)} className={showInviteForm ? 'btn-secondary' : 'btn-primary'}>
            {showInviteForm ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {showInviteForm ? t.common.close : t.team.inviteButton}
          </button>
        )}
      </div>

      {projectId !== 'demo' && !loading && members.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:max-w-md">
          <div className="surface-card p-4">
            <p className="text-caption">{t.team.statTotal}</p>
            <p className="text-h2 mt-1 flex items-center gap-2">
              <Users className="h-4 w-4 text-ink-400" strokeWidth={2.25} />
              {members.length}
            </p>
          </div>
          <div className="surface-card p-4">
            <p className="text-caption">{t.team.statAdmins}</p>
            <p className="text-h2 mt-1">{adminCount}</p>
          </div>
          <div className="surface-card p-4">
            <p className="text-caption">{t.team.statQa}</p>
            <p className="text-h2 mt-1">{qaCount}</p>
          </div>
        </div>
      )}

      {projectId === 'demo' ? (
        <div className="rounded-[var(--radius-card)] border border-amber-200 bg-warning-50 p-6 text-sm font-semibold text-warning-600">
          {t.team.demoNotice}
        </div>
      ) : (
        <>
          {!loading && !isAdmin && (
            <div className="alert-info">{t.team.readOnlyNotice}</div>
          )}

          {showInviteForm && isAdmin && (
            <form onSubmit={inviteMember} className="surface-card flex flex-wrap items-end gap-3 p-6">
              <label className="min-w-56 flex-1">
                <span className="field-label">{t.team.emailLabel}</span>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" strokeWidth={2.25} />
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field-input pl-11"
                    placeholder="teammate@example.com"
                  />
                </div>
              </label>
              <label>
                <span className="field-label">{t.team.roleLabel}</span>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="field-input">
                  <option value="qa">qa — {t.team.roleQaDesc}</option>
                  <option value="admin">admin — {t.team.roleAdminDesc}</option>
                </select>
              </label>
              <button type="submit" disabled={isInviting} className="btn-primary">
                {isInviting && <Loader2 className="h-4 w-4 animate-spin" />}
                {isInviting ? t.team.inviting : t.team.inviteButton}
              </button>
            </form>
          )}

          {error && <div className="alert-danger">{error}</div>}

          <div className="surface-card">
            <div className="border-b border-ink-200/80 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" strokeWidth={2.25} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.team.searchPlaceholder}
                  className="field-input py-2.5 pl-11"
                />
              </div>
            </div>

            {loading && <div className="p-10 text-center text-ink-500">{t.team.loading}</div>}
            {!loading && members.length === 0 && <div className="p-10 text-center text-ink-500">{t.team.empty}</div>}
            {!loading && members.length > 0 && filteredMembers.length === 0 && (
              <div className="p-10 text-center text-ink-500">{t.team.noResults}</div>
            )}

            {filteredMembers.map((member) => {
              const name = member.profiles?.full_name ?? member.user_id;
              const isSelf = member.user_id === currentUserId;
              const isConfirmingRemove = removingUserId === member.user_id;

              return (
                <div key={member.user_id} className="border-b border-ink-100 px-6 py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                        {initials(name)}
                      </span>
                      <div>
                        <p className="flex items-center gap-2 font-bold text-ink-900">
                          {name}
                          {isSelf && <span className="badge-brand">{t.team.youBadge}</span>}
                        </p>
                        <p className="text-caption">
                          {t.team.joinedPrefix} {new Date(member.joined_at).toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-US')}
                        </p>
                        {roleUpdateError[member.user_id] && (
                          <p className="mt-1 text-xs font-semibold text-danger-600">{roleUpdateError[member.user_id]}</p>
                        )}
                        {removeError[member.user_id] && (
                          <p className="mt-1 text-xs font-semibold text-danger-600">{removeError[member.user_id]}</p>
                        )}
                      </div>
                    </div>

                    {isAdmin && isConfirmingRemove ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-ink-600">{t.team.removeConfirmTitle}</span>
                        <button type="button" onClick={() => setRemovingUserId(null)} className="btn-ghost !px-3 !py-1.5 text-xs" disabled={isRemoving}>
                          {t.team.cancelButton}
                        </button>
                        <button type="button" onClick={() => removeMember(member.user_id)} className="btn-danger !px-3 !py-1.5 text-xs" disabled={isRemoving}>
                          {isRemoving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {isRemoving ? t.team.removing : t.team.removeButton}
                        </button>
                      </div>
                    ) : isAdmin ? (
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setEditingUserId(editingUserId === member.user_id ? null : member.user_id)}
                            className={
                              member.role === 'admin'
                                ? 'badge-brand inline-flex items-center gap-1 hover:bg-brand-100'
                                : 'badge-neutral inline-flex items-center gap-1 hover:bg-ink-200'
                            }
                            title={t.team.changeRoleTitle}
                          >
                            {member.role === 'admin' && <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />}
                            {member.role}
                            <ChevronDown className="h-3 w-3" strokeWidth={2.5} />
                          </button>

                          {editingUserId === member.user_id && (
                            <>
                              <button
                                type="button"
                                aria-label={t.common.close}
                                className="fixed inset-0 z-10 cursor-default"
                                onClick={() => setEditingUserId(null)}
                              />
                              <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-[var(--radius-control)] border border-ink-200 bg-white shadow-[var(--shadow-soft-lg)]">
                                {(['qa', 'admin'] as Role[]).map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => updateMemberRole(member.user_id, option)}
                                    className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left hover:bg-brand-50"
                                  >
                                    <span className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                                      {option === 'admin' && <ShieldCheck className="h-3.5 w-3.5 text-brand-600" strokeWidth={2.5} />}
                                      {option}
                                      {option === member.role && <span className="text-brand-600">✓</span>}
                                    </span>
                                    <span className="text-xs text-ink-500">{option === 'admin' ? t.team.roleAdminDesc : t.team.roleQaDesc}</span>
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setRemovingUserId(member.user_id)}
                          aria-label={t.team.removeButton}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={2.25} />
                        </button>
                      </div>
                    ) : (
                      <span className={member.role === 'admin' ? 'badge-brand inline-flex items-center gap-1' : 'badge-neutral'}>
                        {member.role === 'admin' && <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />}
                        {member.role}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
