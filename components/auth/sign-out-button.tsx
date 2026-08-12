'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/language-context';

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const { t } = useLanguage();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button onClick={handleSignOut} className={className ?? 'text-xs font-bold text-ink-400 hover:text-white'}>
      {t.sidebar.signOut}
    </button>
  );
}
