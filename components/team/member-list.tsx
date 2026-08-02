'use client';

import { Search } from 'lucide-react';
import { MemberRow } from './member-row';
import type { TeamMembersState } from './use-team-members';

/** Search box plus the member list itself (loading / empty / no-results / rows). */
export function MemberList({ team }: { team: TeamMembersState }) {
  return (
    <div className="surface-card">
      <div className="border-b border-ink-200/80 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" strokeWidth={2.25} />
          <input
            value={team.search}
            onChange={(e) => team.setSearch(e.target.value)}
            placeholder={team.t.team.searchPlaceholder}
            className="field-input py-2.5 pl-11"
          />
        </div>
      </div>

      {team.loading && <div className="p-10 text-center text-ink-500">{team.t.team.loading}</div>}
      {!team.loading && team.members.length === 0 && <div className="p-10 text-center text-ink-500">{team.t.team.empty}</div>}
      {!team.loading && team.members.length > 0 && team.filteredMembers.length === 0 && (
        <div className="p-10 text-center text-ink-500">{team.t.team.noResults}</div>
      )}

      {team.filteredMembers.map((member) => (
        <MemberRow key={member.user_id} team={team} member={member} />
      ))}
    </div>
  );
}
