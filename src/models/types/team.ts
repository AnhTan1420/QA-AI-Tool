export type Role = 'qa' | 'admin';

export type Member = {
  user_id: string;
  role: Role;
  joined_at: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};
