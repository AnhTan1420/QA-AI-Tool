import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * Consistent "back" navigation used at the top of nested/detail pages
 * (project sub-pages, test case detail, tool detail, etc).
 *
 * Renders as a pill button rather than a bare text link so it reads
 * clearly as a navigational control, with a dedicated icon chip that
 * nudges left on hover/focus for a subtle "go back" motion cue.
 */
export function BackLink({ href, label, title }: { href: string; label: string; title?: string }) {
  return (
    <Link href={href} title={title} className="back-link group">
      <span className="back-link-icon">
        <ArrowLeft className="h-3.5 w-3.5" />
      </span>
      {label}
    </Link>
  );
}
