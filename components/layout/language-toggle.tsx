'use client';

import { useId } from 'react';
import { Languages, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/language-context';
import { isLocale } from '@/lib/i18n/config';

/**
 * Bo doi dropdownlist chon ngon ngu (thay cho nut toggle truoc day) - cho phep
 * chon truc tiep 1 trong 2 gia tri "Tieng Viet" / "English" thay vi phai bam
 * nhieu lan de "xoay vong" qua lai. Van dung chung useLanguage() (locale +
 * setLocale) nen khong can doi gi o cac noi goi component nay.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLanguage();
  const selectId = useId();

  return (
    <div
      className={
        className ??
        'relative inline-flex items-center gap-1.5 rounded-lg border border-ink-200/70 bg-white/80 px-2.5 py-1.5 text-xs font-bold text-ink-600 transition-colors focus-within:border-brand-300 hover:border-brand-300 hover:text-brand-700'
      }
    >
      <Languages className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      <label htmlFor={selectId} className="sr-only">
        Chọn ngôn ngữ / Select language
      </label>
      <select
        id={selectId}
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
        className="cursor-pointer appearance-none bg-transparent pr-4 text-xs font-bold text-ink-600 outline-none"
      >
        <option value="vi">Tiếng Việt</option>
        <option value="en">English</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-ink-400" strokeWidth={2.5} aria-hidden="true" />
    </div>
  );
}
