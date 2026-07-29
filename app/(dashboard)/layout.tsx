import Link from 'next/link';
import { LayoutDashboard, Wrench, FolderKanban, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { NavLink } from '@/components/layout/nav-link';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { getLocale } from '@/lib/i18n/get-locale';
import { getDictionary } from '@/lib/i18n/dictionaries';

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const locale = await getLocale();
  const t = getDictionary(locale);

  const navItems = [
    { href: '/dashboard', label: t.nav.dashboard, icon: LayoutDashboard },
    { href: '/tools', label: t.nav.tools, icon: Wrench },
    { href: '/projects', label: t.nav.projects, icon: FolderKanban },
  ];

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-ink-200/70 bg-white/80 backdrop-blur-xl lg:flex">
        <div className="flex items-center justify-between gap-2.5 px-6 pt-7">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white shadow-[var(--shadow-glow-brand)]">
              <Sparkles className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </span>
            <span className="text-display text-xl">{t.sidebar.brand}</span>
          </Link>
        </div>

        <nav className="mt-8 flex-1 space-y-1.5 px-4">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={<item.icon className="h-[18px] w-[18px]" strokeWidth={2.25} />}
            />
          ))}
        </nav>

        <div className="mx-4 mb-2 flex justify-start">
          <LanguageToggle />
        </div>

        <div className="m-4 mt-2 rounded-2xl bg-ink-900 p-4 text-sm text-ink-300">
          {user ? (
            <>
              <p className="truncate text-sm font-bold text-white">{user.email}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="badge-neutral bg-white/10 text-ink-300">{t.sidebar.loggedIn}</span>
                <SignOutButton className="text-xs font-semibold text-ink-300 transition-colors hover:text-white" />
              </div>
            </>
          ) : (
            <>
              <p className="font-bold text-white">{t.sidebar.notLoggedIn}</p>
              <Link href="/login" className="mt-2 inline-block text-xs font-semibold text-brand-300 transition-colors hover:text-brand-200">
                {t.sidebar.loginNow}
              </Link>
            </>
          )}
        </div>
      </aside>

      <div className="lg:pl-72">
        {/* Mobile header */}
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-200/70 bg-white/80 px-6 py-4 backdrop-blur-xl lg:hidden">
          <Link href="/" className="text-display flex items-center gap-2 text-lg">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Sparkles className="h-4 w-4" strokeWidth={2.5} />
            </span>
            {t.sidebar.brand}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            {user && <SignOutButton className="text-xs font-semibold text-ink-500 hover:text-brand-700" />}
          </div>
        </header>

        {/* Mobile bottom-nav-style quick links */}
        <nav className="flex gap-1.5 overflow-x-auto border-b border-ink-200/70 bg-white/80 px-4 py-2 backdrop-blur-xl lg:hidden">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={<item.icon className="h-[18px] w-[18px]" strokeWidth={2.25} />}
            />
          ))}
        </nav>

        <main className="mx-auto max-w-7xl px-6 py-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
