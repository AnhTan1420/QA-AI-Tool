'use client';

import { Users } from 'lucide-react';
import type { TeamMembersState } from '@/hooks/team/use-team-members';

/** The 3-up "total / admins / qa" stat cards shown above the member list. */
export function TeamStats({ team }: { team: TeamMembersState }) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:max-w-md">
      <div className="surface-card p-4">
        <p className="text-caption">{team.t.team.statTotal}</p>
        <p className="text-h2 mt-1 flex items-center gap-2">
          <Users className="h-4 w-4 text-ink-400" strokeWidth={2.25} />
          {team.members.length}
        </p>
      </div>
      <div className="surface-card p-4">
        <p className="text-caption">{team.t.team.statAdmins}</p>
        <p className="text-h2 mt-1">{team.adminCount}</p>
      </div>
      <div className="surface-card p-4">
        <p className="text-caption">{team.t.team.statQa}</p>
        <p className="text-h2 mt-1">{team.qaCount}</p>
      </div>
    </div>
  );
}
