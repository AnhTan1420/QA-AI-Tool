'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button onClick={handleSignOut} className={className ?? 'text-xs font-bold text-slate-400 hover:text-white'}>
      Đăng xuất
    </button>
  );
}
