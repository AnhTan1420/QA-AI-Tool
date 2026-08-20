'use client';

import { use } from 'react';
import { UserPlus, X } from 'lucide-react';
import { useTeamMembers } from '@/hooks/team/use-team-members';
import { TeamStats } from '@/views/team/team-stats';
import { InviteForm } from '@/views/team/invite-form';
import { MemberList } from '@/views/team/member-list';
import { BackLink } from '@/views/layout/back-link';

export default function TeamPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const team = useTeamMembers(projectId);
  const { t } = team;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <BackLink href={`/projects/${projectId}`} label={t.common.back} />
          <p className="text-eyebrow mt-4">{t.team.eyebrow}</p>
          <h1 className="text-h1 mt-2">{t.team.title}</h1>
          <p className="text-body mt-2 max-w-2xl">{t.team.subtitle}</p>
        </div>

        {projectId !== 'demo' && team.isAdmin && (
          <button onClick={() => team.setShowInviteForm((v) => !v)} className={team.showInviteForm ? 'btn-secondary' : 'btn-primary'}>
            {team.showInviteForm ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {team.showInviteForm ? t.common.close : t.team.inviteButton}
          </button>
        )}
      </div>

      {projectId !== 'demo' && !team.loading && team.members.length > 0 && <TeamStats team={team} />}

      {projectId === 'demo' ? (
        <div className="rounded-[var(--radius-card)] border border-warning-600/20 bg-warning-50 p-6 text-sm font-semibold text-warning-600">
          {t.team.demoNotice}
        </div>
      ) : (
        <>
          {!team.loading && !team.isAdmin && (
            <div className="alert-info">{t.team.readOnlyNotice}</div>
          )}

          {team.showInviteForm && team.isAdmin && <InviteForm team={team} />}

          {team.error && <div className="alert-danger">{team.error}</div>}

          <MemberList team={team} />
        </>
      )}
    </div>
  );
}
