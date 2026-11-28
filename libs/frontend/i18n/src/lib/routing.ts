import { defineRouting } from 'next-intl/routing';
import { defaultLocale, locales } from './config';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  // The cookie that remembers the chosen language: sent over HTTPS only in production, and
  // not with requests other sites make.
  localeCookie: { sameSite: 'lax', secure: process.env.NODE_ENV === 'production' },
});
