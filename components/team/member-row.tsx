'use client';

import { ChevronDown, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import type { Member, Role } from './types';
import type { TeamMembersState } from './use-team-members';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** One row in the member list: avatar/name, and (for admins) a role editor + remove control. */
export function MemberRow({ team, member }: { team: TeamMembersState; member: Member }) {
  const { t, locale } = team;
  const name = member.profiles?.full_name ?? member.user_id;
  const isSelf = member.user_id === team.currentUserId;
  const isConfirmingRemove = team.removingUserId === member.user_id;
  const isEditingRole = team.editingUserId === member.user_id;

  return (
    <div className="border-b border-ink-100 px-6 py-4 last:border-b-0">
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
            {team.roleUpdateError[member.user_id] && (
              <p className="mt-1 text-xs font-semibold text-danger-600">{team.roleUpdateError[member.user_id]}</p>
            )}
            {team.removeError[member.user_id] && (
              <p className="mt-1 text-xs font-semibold text-danger-600">{team.removeError[member.user_id]}</p>
            )}
          </div>
        </div>

        {team.isAdmin && isConfirmingRemove ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-600">{t.team.removeConfirmTitle}</span>
            <button type="button" onClick={() => team.setRemovingUserId(null)} className="btn-ghost !px-3 !py-1.5 text-xs" disabled={team.isRemoving}>
              {t.team.cancelButton}
            </button>
            <button type="button" onClick={() => team.removeMember(member.user_id)} className="btn-danger !px-3 !py-1.5 text-xs" disabled={team.isRemoving}>
              {team.isRemoving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {team.isRemoving ? t.team.removing : t.team.removeButton}
            </button>
          </div>
        ) : team.isAdmin ? (
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                type="button"
                onClick={() => team.setEditingUserId(isEditingRole ? null : member.user_id)}
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

              {isEditingRole && (
                <>
                  <button
                    type="button"
                    aria-label={t.common.close}
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => team.setEditingUserId(null)}
                  />
                  <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-[var(--radius-control)] border border-ink-200 bg-white shadow-[var(--shadow-soft-lg)]">
                    {(['qa', 'admin'] as Role[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => team.updateMemberRole(member.user_id, option)}
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
              onClick={() => team.setRemovingUserId(member.user_id)}
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
}
