import type { Locale } from '../config';
import vi, { type Dictionary } from './vi';
import en from './en';

export type { Dictionary };

export const translations = { vi, en } satisfies Record<Locale, Dictionary>;

export function getDictionary(locale: Locale): Dictionary {
  return translations[locale];
}
