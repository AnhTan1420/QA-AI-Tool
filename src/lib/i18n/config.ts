export type Locale = 'vi' | 'en';

export const LOCALES: Locale[] = ['vi', 'en'];
export const DEFAULT_LOCALE: Locale = 'vi';
export const LOCALE_COOKIE_NAME = 'qajd_locale';

export function isLocale(value: string | undefined | null): value is Locale {
  return value === 'vi' || value === 'en';
}
