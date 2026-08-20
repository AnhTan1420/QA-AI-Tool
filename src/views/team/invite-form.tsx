'use client';

import { Loader2, Mail } from 'lucide-react';
import type { Role } from '@/models/types/team';
import type { TeamMembersState } from '@/hooks/team/use-team-members';

/** The inline "invite a teammate by email + role" form. */
export function InviteForm({ team }: { team: TeamMembersState }) {
  return (
    <form onSubmit={team.inviteMember} className="surface-card flex flex-wrap items-end gap-3 p-6">
      <label className="min-w-56 flex-1">
        <span className="field-label">{team.t.team.emailLabel}</span>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" strokeWidth={2.25} />
          <input
            required
            type="email"
            value={team.email}
            onChange={(e) => team.setEmail(e.target.value)}
            className="field-input pl-11"
            placeholder="teammate@example.com"
          />
        </div>
      </label>
      <label>
        <span className="field-label">{team.t.team.roleLabel}</span>
        <select value={team.role} onChange={(e) => team.setRole(e.target.value as Role)} className="field-input">
          <option value="qa">qa — {team.t.team.roleQaDesc}</option>
          <option value="admin">admin — {team.t.team.roleAdminDesc}</option>
        </select>
      </label>
      <button type="submit" disabled={team.isInviting} className="btn-primary">
        {team.isInviting && <Loader2 className="h-4 w-4 animate-spin" />}
        {team.isInviting ? team.t.team.inviting : team.t.team.inviteButton}
      </button>
    </form>
  );
}
