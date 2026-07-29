'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  const pathname = usePathname();
  const isActive = href === '/dashboard' ? pathname === href : pathname.startsWith(href);

  return (
    <Link href={href} className={isActive ? 'nav-link-active' : 'nav-link'} aria-current={isActive ? 'page' : undefined}>
      {icon}
      {label}
    </Link>
  );
}
