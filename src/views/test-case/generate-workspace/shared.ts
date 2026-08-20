import { TEST_CASE_CATEGORIES } from '@/models/test-case-taxonomy';

export const VALID_CATEGORY_VALUES = TEST_CASE_CATEGORIES.map((c) => c.value);

// Thin, modern, self-hiding scrollbar (webkit + firefox) — reused on every scrollable panel
export const SCROLLBAR =
  '[scrollbar-width:thin] [scrollbar-color:#cbd5e1_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300/70 [&::-webkit-scrollbar-thumb]:transition-colors hover:[&::-webkit-scrollbar-thumb]:bg-slate-400';
