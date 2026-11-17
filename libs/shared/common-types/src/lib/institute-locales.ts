export const instituteLocaleLabels: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  kn: 'ಕನ್ನಡ',
  ml: 'മലയാളം',
  mr: 'मराठी',
  gu: 'ગુજરાતી',
  bn: 'বাংলা',
  pa: 'ਪੰਜਾਬੀ',
  ur: 'اردو',
  or: 'ଓଡ଼ିଆ',
  as: 'অসমীয়া',
};

export interface InstituteLocaleSettings {
  supportedLocales: string[];
  defaultLocale: string;
}

export function validInstituteLocales(settings: InstituteLocaleSettings): boolean {
  return (
    settings.supportedLocales.length > 0 &&
    new Set(settings.supportedLocales).size === settings.supportedLocales.length &&
    settings.supportedLocales.includes('en') &&
    settings.supportedLocales.includes(settings.defaultLocale) &&
    settings.supportedLocales.every((locale) => Object.hasOwn(instituteLocaleLabels, locale))
  );
}
