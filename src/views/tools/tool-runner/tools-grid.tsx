'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { TOOL_SLUGS } from './shared';

export function ToolsGrid() {
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const tools = TOOL_SLUGS.map((slug) => ({ slug, ...t.tools.definitions[slug] }));
  const filtered = tools.filter((tool) => `${tool.title} ${tool.group}`.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t.tools.searchPlaceholder}
          className="field-input py-4 pl-11 shadow-[var(--shadow-soft)]"
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((tool) => (
          <Link key={tool.slug} href={`/tools/${tool.slug}`} className="surface-card-interactive p-6">
            <p className="text-eyebrow">{tool.group}</p>
            <h2 className="text-h3 mt-3">{tool.title}</h2>
            <p className="text-body mt-2 text-sm">{tool.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
