'use client';

import { useState } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

export interface SessionData {
  id: string;
  deviceInfo?: string;
  ipAddress?: string;
  userAgent?: string;
  lastUsedAt?: string;
  createdAt: string;
  expiresAt?: string;
  isCurrent: boolean;
}

interface SessionsPageProps {
  sessions: SessionData[];
  loading: boolean;
  onRevoke: (sessionId: string) => Promise<void>;
  onRevokeAllOther: () => Promise<void>;
}

export function SessionsPage({ sessions, loading, onRevoke, onRevokeAllOther }: SessionsPageProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await onRevoke(id);
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevokingAll(true);
    try {
      await onRevokeAllOther();
    } finally {
      setRevokingAll(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Active Sessions</h1>
          <p className="text-muted-foreground">Manage your active login sessions across devices.</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={handleRevokeAll}
          disabled={revokingAll || loading}
        >
          {revokingAll ? 'Revoking...' : 'Revoke All Other Sessions'}
        </Button>
      </div>
      <div className="grid gap-4">
        {loading && <p className="text-muted-foreground">Loading sessions...</p>}
        {!loading && sessions.length === 0 && (
          <p className="text-muted-foreground">No active sessions.</p>
        )}
        {sessions.map((session) => (
          <Card key={session.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{session.userAgent || 'Unknown Device'}</CardTitle>
                {session.isCurrent && <Badge variant="secondary">Current</Badge>}
              </div>
              <CardDescription>{session.ipAddress || 'Unknown IP'}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Created {new Date(session.createdAt).toLocaleDateString()}
              </span>
              {!session.isCurrent && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRevoke(session.id)}
                  disabled={revoking === session.id}
                >
                  {revoking === session.id ? 'Revoking...' : 'Revoke'}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
