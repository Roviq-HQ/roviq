'use client';

import { Button } from '@roviq/ui';
import { Card, CardContent, CardHeader, CardTitle } from '@roviq/ui/components/ui/card';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const EXCHANGE_CODE_MUTATION = `
  mutation ExchangeImpersonationCode($code: String!) {
    exchangeImpersonationCode(code: $code) {
      accessToken
      user { id username }
      institute { id name }
    }
  }
`;

export default function ImpersonatePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const code = searchParams.get('code');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) {
      setError('No impersonation code provided');
      setLoading(false);
      return;
    }

    async function exchangeCode() {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/api/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: EXCHANGE_CODE_MUTATION,
            variables: { code },
          }),
        });

        const result = await response.json();

        if (result.errors) {
          setError(result.errors[0]?.message || 'Code expired or invalid');
          setLoading(false);
          return;
        }

        const { accessToken, user } = result.data.exchangeImpersonationCode;

        // Store impersonation token + user name in sessionStorage (NOT localStorage)
        // Dies with the tab — clean separation from main session
        sessionStorage.setItem('roviq-impersonation-token', accessToken);
        if (user?.username) {
          sessionStorage.setItem('roviq-impersonation-user-name', user.username);
        }

        // Redirect to institute dashboard
        router.replace('/institute/dashboard');
      } catch {
        setError('Failed to exchange impersonation code');
      } finally {
        setLoading(false);
      }
    }

    exchangeCode();
  }, [code, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Establishing impersonation session...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Impersonation Failed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-destructive">{error}</p>
            <Button onClick={() => window.close()} variant="outline">
              Close Tab
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}
