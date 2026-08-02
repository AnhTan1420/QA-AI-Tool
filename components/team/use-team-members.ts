'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import { createClient } from '@/lib/supabase/client';
import type { Member, Role } from './types';

/** All state and API calls for the project team page: list, invite, change role, remove. */
export function useTeamMembers(projectId: string) {
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

  return {
    t, locale, projectId,
    members, loading, error, currentUserId,
    search, setSearch,
    showInviteForm, setShowInviteForm,
    email, setEmail, role, setRole, isInviting, inviteMember,
    editingUserId, setEditingUserId, roleUpdateError,
    removingUserId, setRemovingUserId, isRemoving, removeError,
    updateMemberRole, removeMember,
    currentMember, isAdmin, adminCount, qaCount, filteredMembers,
  };
}

export type TeamMembersState = ReturnType<typeof useTeamMembers>;
