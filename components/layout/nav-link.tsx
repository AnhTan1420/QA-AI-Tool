'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';

export function NavLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  const pathname = usePathname();
  const isActive = href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <Link href={href} className={isActive ? 'nav-link-active' : 'nav-link'} aria-current={isActive ? 'page' : undefined}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={2.25} />
      {label}
    </Link>
  );
}
