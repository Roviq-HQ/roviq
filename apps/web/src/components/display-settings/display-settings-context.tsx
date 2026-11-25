'use client';

import { useAuth } from '@roviq/auth';
import {
  DEFAULT_FORM_HELP_MODE,
  FORM_HELP_MODE_VALUES,
  type FormHelpMode,
} from '@roviq/common-types';
import { gql, useApolloClient } from '@roviq/graphql';
import { FormHelpModeProvider } from '@roviq/ui';
import { useTranslations } from 'next-intl';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import type {
  MyFormHelpModeQuery,
  UpdateMyFormHelpModeMutation,
  UpdateMyFormHelpModeMutationVariables,
} from './display-settings-context.generated';
import { DisplaySettingsDialog } from './display-settings-dialog';

const MY_FORM_HELP_MODE = gql`
  query MyFormHelpMode {
    myFormHelpMode
  }
`;

const UPDATE_MY_FORM_HELP_MODE = gql`
  mutation UpdateMyFormHelpMode($mode: FormHelpMode!) {
    updateMyFormHelpMode(mode: $mode)
  }
`;

const cacheKey = (userId: string) => `roviq:form-help-mode:${userId}`;

function readCachedMode(userId: string): FormHelpMode | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    return FORM_HELP_MODE_VALUES.find((mode) => mode === raw) ?? null;
  } catch {
    return null;
  }
}

function writeCachedMode(userId: string, mode: FormHelpMode): void {
  try {
    window.localStorage.setItem(cacheKey(userId), mode);
  } catch {
    // Storage may be disabled; the server value still applies.
  }
}

export interface DisplaySettingsValue {
  formHelpMode: FormHelpMode;
  /** True until the server answers for the signed-in account. */
  loading: boolean;
  loadFailed: boolean;
  saving: boolean;
  /** Impersonation sessions see the default and cannot save. */
  readOnly: boolean;
  saveFormHelpMode: (mode: FormHelpMode) => void;
  reload: () => void;
  openDisplaySettings: () => void;
}

const DisplaySettingsContext = createContext<DisplaySettingsValue | null>(null);

interface LoadedMode {
  userId: string;
  mode: FormHelpMode;
  confirmed: boolean;
  failed: boolean;
}

/**
 * Loads the signed-in account's form help mode, supplies it to every form, and hosts the
 * Display settings dialog. Office computers are shared, so the browser copy is kept per account.
 */
export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const { user, isImpersonated, mustChangePassword } = useAuth();
  const client = useApolloClient();
  const t = useTranslations('account.displaySettings');
  const userId = user?.id;
  const [loaded, setLoaded] = useState<LoadedMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const request = useRef(0);

  const load = useCallback(() => {
    const current = ++request.current;
    // The server refuses every other request until the password is changed.
    if (!userId || mustChangePassword) {
      setLoaded(null);
      return;
    }
    const cached = isImpersonated ? null : readCachedMode(userId);
    setLoaded({
      userId,
      mode: cached ?? DEFAULT_FORM_HELP_MODE,
      confirmed: false,
      failed: false,
    });
    client
      .query<MyFormHelpModeQuery>({
        query: MY_FORM_HELP_MODE,
        fetchPolicy: 'network-only',
        // The answer depends on whose session asks: never share an earlier account's request.
        context: { queryDeduplication: false },
      })
      .then(
        ({ data }) => {
          if (current !== request.current || !data) return;
          const mode = data.myFormHelpMode;
          if (!isImpersonated) writeCachedMode(userId, mode);
          setLoaded({ userId, mode, confirmed: true, failed: false });
        },
        () => {
          if (current !== request.current) return;
          setLoaded((prev) => (prev && prev.userId === userId ? { ...prev, failed: true } : prev));
        },
      );
  }, [client, userId, isImpersonated, mustChangePassword]);

  useEffect(() => load(), [load]);

  const active = loaded && loaded.userId === userId ? loaded : null;
  const formHelpMode = active?.mode ?? DEFAULT_FORM_HELP_MODE;

  const saveFormHelpMode = useCallback(
    (mode: FormHelpMode) => {
      if (!userId || isImpersonated) return;
      const saveFor = userId;
      setSaving(true);
      client
        .mutate<UpdateMyFormHelpModeMutation, UpdateMyFormHelpModeMutationVariables>({
          mutation: UPDATE_MY_FORM_HELP_MODE,
          variables: { mode },
        })
        .then(
          ({ data }) => {
            const saved = data?.updateMyFormHelpMode;
            if (!saved) return;
            writeCachedMode(saveFor, saved);
            setLoaded((prev) =>
              prev && prev.userId === saveFor
                ? { userId: saveFor, mode: saved, confirmed: true, failed: false }
                : prev,
            );
            toast.success(t('saved'));
          },
          () => {
            toast.error(t('saveFailed'), {
              duration: Number.POSITIVE_INFINITY,
              action: { label: t('retry'), onClick: () => saveFormHelpMode(mode) },
            });
          },
        )
        .finally(() => setSaving(false));
    },
    [client, userId, isImpersonated, t],
  );

  const value = useMemo<DisplaySettingsValue>(
    () => ({
      formHelpMode,
      loading: Boolean(userId) && !mustChangePassword && !active?.confirmed && !active?.failed,
      loadFailed: Boolean(active?.failed),
      saving,
      readOnly: isImpersonated,
      saveFormHelpMode,
      reload: load,
      openDisplaySettings: () => setDialogOpen(true),
    }),
    [
      formHelpMode,
      userId,
      mustChangePassword,
      active,
      saving,
      isImpersonated,
      saveFormHelpMode,
      load,
    ],
  );

  return (
    <DisplaySettingsContext.Provider value={value}>
      <FormHelpModeProvider mode={formHelpMode}>
        {children}
        <DisplaySettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </FormHelpModeProvider>
    </DisplaySettingsContext.Provider>
  );
}

export function useDisplaySettings(): DisplaySettingsValue {
  const value = useContext(DisplaySettingsContext);
  if (!value) throw new Error('useDisplaySettings must be used inside DisplaySettingsProvider');
  return value;
}
