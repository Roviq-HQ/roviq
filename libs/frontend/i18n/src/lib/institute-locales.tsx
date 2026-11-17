'use client';

import type { InstituteLocaleSettings } from '@roviq/common-types';
import { createContext, createElement, type ReactNode, useContext } from 'react';

const InstituteLocalesContext = createContext<InstituteLocaleSettings>({
  supportedLocales: ['en', 'hi'],
  defaultLocale: 'en',
});

export function InstituteLocalesProvider({
  value,
  children,
}: {
  value: InstituteLocaleSettings;
  children: ReactNode;
}) {
  return createElement(InstituteLocalesContext.Provider, { value }, children);
}

export function useInstituteLocales() {
  return useContext(InstituteLocalesContext);
}
