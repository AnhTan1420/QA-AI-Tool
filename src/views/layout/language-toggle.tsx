'use client';

import { Languages } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLanguage();

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}
      className={
        className ??
        'inline-flex items-center gap-1.5 rounded-lg border border-ink-200/70 bg-white/80 px-2.5 py-1.5 text-xs font-bold text-ink-600 transition-colors hover:border-brand-300 hover:text-brand-700'
      }
      aria-label="Toggle language / Chuyển đổi ngôn ngữ"
      title="EN / VI"
    >
      <Languages className="h-3.5 w-3.5" strokeWidth={2.25} />
      <span className={locale === 'vi' ? 'text-brand-600' : 'text-ink-400'}>VI</span>
      <span className="text-ink-300">/</span>
      <span className={locale === 'en' ? 'text-brand-600' : 'text-ink-400'}>EN</span>
    </button>
  );
}
