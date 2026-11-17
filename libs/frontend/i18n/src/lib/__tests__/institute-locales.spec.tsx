import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { InstituteLocalesProvider } from '../institute-locales';
import { useI18nField } from '../use-i18n-field';

vi.mock('next-intl', () => ({ useLocale: () => 'hi' }));

describe('institute text fallback', () => {
  it('uses the institute default and updates when switching institutes', () => {
    let defaultLocale = 'ta';
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(InstituteLocalesProvider, {
        value: { supportedLocales: ['en', defaultLocale], defaultLocale },
        children,
      });
    const { result, rerender } = renderHook(() => useI18nField(), { wrapper });
    const name = { en: 'Science', ta: 'அறிவியல்', mr: 'विज्ञान' };
    expect(result.current(name)).toBe(name.ta);
    defaultLocale = 'mr';
    rerender();
    expect(result.current(name)).toBe(name.mr);
    expect(result.current({ hi: '  ', en: 'Fallback' })).toBe('Fallback');
    expect(result.current({ en: '', ta: '' })).toBe('');
  });
});
