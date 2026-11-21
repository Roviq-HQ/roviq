'use client';

import * as React from 'react';
import { useAuth } from './auth-context';

interface ProtectedRouteProps {
  loginPath?: string;
  selectInstitutePath?: string;
  /** Where an account that must change its password is sent; every other page is withheld. */
  changePasswordPath?: string;
  children: React.ReactNode;
}

export function ProtectedRoute({
  loginPath = '/login',
  selectInstitutePath = '/select-institute',
  changePasswordPath = '/change-password',
  children,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, needsInstituteSelection, mustChangePassword } = useAuth();

  React.useEffect(() => {
    if (isLoading) return;

    const currentPath = window.location.pathname + window.location.search;
    const returnUrl = encodeURIComponent(currentPath);

    if (needsInstituteSelection) {
      // Preserve the requested page through institute selection.
      window.location.href = `${selectInstitutePath}?returnUrl=${returnUrl}`;
      return;
    }

    if (!isAuthenticated) {
      window.location.href = `${loginPath}?returnUrl=${returnUrl}`;
      return;
    }

    if (mustChangePassword) {
      window.location.href = changePasswordPath;
    }
  }, [
    isAuthenticated,
    isLoading,
    needsInstituteSelection,
    mustChangePassword,
    loginPath,
    selectInstitutePath,
    changePasswordPath,
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="border-primary h-8 w-8 animate-spin rounded-full border-4 border-t-transparent" />
      </div>
    );
  }

  // Nothing under the route renders, so no page query fires for these sessions.
  if (!isAuthenticated || needsInstituteSelection || mustChangePassword) {
    return null;
  }

  return <>{children}</>;
}
