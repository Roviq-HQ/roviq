'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { testIds } from '../testing/testid-registry';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const { sessions: ids } = testIds;

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

export interface SessionsPageLabels {
  title: string;
  description: string;
  revokeAll: string;
  revoking: string;
  revoke: string;
  loading: string;
  noSessions: string;
  unknownDevice: string;
  unknownIp: string;
  current: string;
  created: string;
  device: string;
  ip: string;
  lastUsed: string;
  unknownLastUsed: string;
  loadError: string;
  revokeError: string;
  revoked: string;
  revokedOthers: string;
  retry: string;
}

interface SessionsPageProps {
  sessions: SessionData[];
  loading: boolean;
  error: boolean;
  labels: SessionsPageLabels;
  formatDate: (dateString: string) => string;
  onRevoke: (sessionId: string) => Promise<void>;
  onRevokeAllOther: () => Promise<void>;
  onRetry: () => Promise<void>;
}

export function SessionsPage({
  sessions,
  loading,
  error,
  labels,
  formatDate,
  onRevoke,
  onRevokeAllOther,
  onRetry,
}: SessionsPageProps) {
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const busy = revoking !== null || revokingAll || loading;

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      await onRevoke(id);
      toast.success(labels.revoked);
    } catch {
      toast.error(labels.revokeError, { duration: Infinity });
    } finally {
      setRevoking(null);
    }
  };

  const handleRevokeAll = async () => {
    setRevokingAll(true);
    try {
      await onRevokeAllOther();
      toast.success(labels.revokedOthers);
    } catch {
      toast.error(labels.revokeError, { duration: Infinity });
    } finally {
      setRevokingAll(false);
    }
  };

  return (
    <div className="space-y-6 p-6" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid={ids.title}>
            {labels.title}
          </h1>
          <p className="text-muted-foreground">{labels.description}</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          title={labels.revokeAll}
          data-testid={ids.revokeAll}
          onClick={handleRevokeAll}
          disabled={busy || error || !sessions.some((session) => !session.isCurrent)}
        >
          {revokingAll ? labels.revoking : labels.revokeAll}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive" data-testid={ids.error}>
          <AlertDescription>{labels.loadError}</AlertDescription>
          <Button title={labels.retry} data-testid={ids.retry} onClick={onRetry} disabled={busy}>
            {labels.retry}
          </Button>
        </Alert>
      )}
      {loading && <p data-testid={ids.loading}>{labels.loading}</p>}
      {!loading && !error && sessions.length === 0 && (
        <p data-testid={ids.empty}>{labels.noSessions}</p>
      )}
      {!error && sessions.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.device}</TableHead>
              <TableHead>{labels.ip}</TableHead>
              <TableHead>{labels.lastUsed}</TableHead>
              <TableHead>{labels.created}</TableHead>
              <TableHead>
                <span className="sr-only">{labels.revoke}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id} data-testid={ids.item}>
                <TableCell
                  className="max-w-64 whitespace-normal break-words"
                  data-testid={ids.userAgent}
                >
                  {session.deviceInfo || session.userAgent || labels.unknownDevice}
                  {session.isCurrent && (
                    <Badge variant="secondary" className="ms-2" data-testid={ids.current}>
                      {labels.current}
                    </Badge>
                  )}
                </TableCell>
                <TableCell data-testid={ids.ipAddress}>
                  {session.ipAddress || labels.unknownIp}
                </TableCell>
                <TableCell>
                  {session.lastUsedAt ? formatDate(session.lastUsedAt) : labels.unknownLastUsed}
                </TableCell>
                <TableCell>{formatDate(session.createdAt)}</TableCell>
                <TableCell>
                  {!session.isCurrent && (
                    <Button
                      variant="outline"
                      size="sm"
                      title={labels.revoke}
                      data-testid={ids.revoke(session.id)}
                      onClick={() => handleRevoke(session.id)}
                      disabled={busy}
                    >
                      {revoking === session.id ? labels.revoking : labels.revoke}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
