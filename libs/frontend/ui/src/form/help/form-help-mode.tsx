'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { DEFAULT_FORM_HELP_MODE, type FormHelpMode } from './field-help';

const FormHelpModeContext = createContext<FormHelpMode>(DEFAULT_FORM_HELP_MODE);

/** The web app supplies the signed-in account's saved mode; without a provider fields use the default. */
export function FormHelpModeProvider({
  mode,
  children,
}: {
  mode: FormHelpMode;
  children: ReactNode;
}) {
  return <FormHelpModeContext.Provider value={mode}>{children}</FormHelpModeContext.Provider>;
}

export function useFormHelpMode(): FormHelpMode {
  return useContext(FormHelpModeContext);
}
