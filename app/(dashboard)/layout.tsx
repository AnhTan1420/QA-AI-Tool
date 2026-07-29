import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from '@/components/auth/sign-out-button';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/tools', label: 'QA Toolkit' },
  { href: '/projects', label: 'Projects' },
];

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-200 bg-white p-6 lg:block">
        <Link href="/" className="text-2xl font-black tracking-tight text-slate-950">
          QAForge
        </Link>
        <nav className="mt-8 space-y-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} className="block rounded-xl px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-blue-50 hover:text-blue-700">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-6 left-6 right-6 rounded-2xl bg-slate-950 p-4 text-sm text-slate-300">
          {user ? (
            <>
              <p className="truncate font-bold text-white">{user.email}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-400">Đã đăng nhập</span>
                <SignOutButton />
              </div>
            </>
          ) : (
            <>
              <p className="font-bold text-white">Chưa đăng nhập</p>
              <Link href="/login" className="mt-1 block text-xs text-blue-300 hover:text-blue-200">Đăng nhập ngay →</Link>
            </>
          )}
        </div>
      </aside>
      <div className="lg:pl-72">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/85 px-6 py-4 backdrop-blur lg:hidden">
          <Link href="/" className="text-xl font-black text-slate-950">QAForge</Link>
          {user && <SignOutButton className="text-xs font-bold text-slate-500 hover:text-blue-700" />}
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
