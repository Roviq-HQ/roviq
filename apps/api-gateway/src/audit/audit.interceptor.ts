import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import { metrics } from '@opentelemetry/api';
import {
  AuditEmitter,
  type AuditEventPayload,
  AuditInstitute,
  markedAuditInstitute,
  NoAudit,
} from '@roviq/audit';
import { type AuthUser, isSyntheticContext } from '@roviq/common-types';
import { catchError, type Observable, tap } from 'rxjs';
import { extractActionType, extractEntityType } from './audit.helpers';

/**
 * JSON-safe serialization of mutation args.
 * BigInt values (e.g., billing paise amounts) are converted to strings
 * since JSON.stringify throws on BigInt.
 */
function safeSerializeArgs(args: unknown): Record<string, unknown> | null {
  try {
    return JSON.parse(
      JSON.stringify(args, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)),
    );
  } catch {
    return null;
  }
}

/**
 * Global interceptor that captures all GraphQL mutations and emits
 * scope-aware audit events via NATS JetStream.
 *
 * - Skips queries, subscriptions, and @NoAudit() mutations
 * - Builds scope-aware payload based on req.user.scope
 * - Handles impersonation (actor_id vs user_id split)
 * - Publishes to 'AUDIT.log' on success, 'AUDIT.error' on failure
 * - Non-blocking — publish happens after response is sent
 *
 * Must run AFTER GqlAuthGuard (needs req.user populated).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);
  private readonly meter = metrics.getMeter('audit');
  private readonly publishedCounter = this.meter.createCounter('audit_events_published_total', {
    description: 'Total audit events published to NATS',
  });
  private readonly errorCounter = this.meter.createCounter('audit_events_error_total', {
    description: 'Total audit event publish errors',
  });
  private readonly impersonationCounter = this.meter.createCounter('audit_impersonation_total', {
    description: 'Total audit events during impersonation',
  });

  constructor(
    private readonly reflector: Reflector,
    private readonly auditEmitter: AuditEmitter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only intercept GraphQL requests
    if (context.getType<GqlContextType>() !== 'graphql') {
      return next.handle();
    }

    const gqlContext = GqlExecutionContext.create(context);
    const info = gqlContext.getInfo();

    // Skip queries and subscriptions — only intercept mutations
    if (info.parentType.name !== 'Mutation') {
      return next.handle();
    }

    // Skip @NoAudit() decorated mutations
    const noAudit = this.reflector.get(NoAudit, context.getHandler());
    if (noAudit) {
      return next.handle();
    }

    const req = gqlContext.getContext().req;
    const user: AuthUser | undefined = req.user;

    // No user = unauthenticated (shouldn't happen for mutations, but guard)
    if (!user) {
      return next.handle();
    }

    const fromArgs = readInstituteId(
      gqlContext.getArgs(),
      this.reflector.get(AuditInstitute, context.getHandler()),
    );
    // Read when the event is built: a resolver may name the institute only after it ran.
    // A refused attempt proves nothing about the caller's right over the institute in its
    // arguments, so then only the platform (which has that right over every institute) or
    // an id the server itself confirmed is used. Otherwise a reseller could write rows,
    // with text of its choosing, into the audit log of an institute it does not own.
    const subjectOf = (succeeded: boolean) => {
      if (user.scope === 'institute') return null;
      const confirmed = markedAuditInstitute(req);
      if (succeeded || user.scope === 'platform') return fromArgs ?? confirmed;
      return confirmed;
    };
    const actionType = extractActionType(info.fieldName);
    const entityType = extractEntityType(info.fieldName);
    const correlationId: string = req.correlationId ?? crypto.randomUUID();

    return next.handle().pipe(
      tap({
        next: (result) => {
          const payload = this.buildPayload(user, req, {
            action: info.fieldName,
            actionType,
            entityType,
            entityId: ((result as Record<string, unknown>)?.id as string) ?? null,
            changes: null,
            metadata: { input: safeSerializeArgs(gqlContext.getArgs()) },
            correlationId,
            subjectTenantId: subjectOf(true),
          });

          // Non-blocking — fire and forget
          void this.auditEmitter
            .emit(payload)
            .then(() => {
              this.publishedCounter.add(1, {
                scope: payload.scope,
                source: payload.source,
                entity_type: payload.entityType,
              });
              if (payload.impersonatorId) {
                this.impersonationCounter.add(1, { scope: payload.scope });
              }
            })
            .catch((err) => {
              this.errorCounter.add(1, { error_type: 'publish_failure' });
              this.logger.error(
                `Failed to emit audit event for ${info.fieldName}`,
                err instanceof Error ? err.stack : String(err),
              );
            });
        },
      }),
      catchError((err) => {
        const payload = this.buildPayload(user, req, {
          action: info.fieldName,
          actionType,
          entityType,
          entityId: null,
          changes: null,
          metadata: {
            input: safeSerializeArgs(gqlContext.getArgs()),
            error: {
              code: err instanceof Error ? err.name : 'UnknownError',
              message: err instanceof Error ? err.message : String(err),
            },
          },
          correlationId,
          subjectTenantId: subjectOf(false),
        });

        // Non-blocking error audit — don't let audit failure mask the real error
        void this.auditEmitter
          .emit(payload)
          .then(() => {
            this.errorCounter.add(1, { error_type: 'mutation_failure' });
          })
          .catch((auditErr) => {
            this.errorCounter.add(1, { error_type: 'publish_failure' });
            this.logger.error(
              `Failed to emit audit.error for ${info.fieldName}`,
              auditErr instanceof Error ? auditErr.stack : String(auditErr),
            );
          });

        throw err;
      }),
    );
  }

  /**
   * Build a scope-aware audit payload from the authenticated user context.
   *
   * - platform → tenantId=null, resellerId=null
   * - reseller → tenantId=null, resellerId from user
   * - institute → tenantId from user, resellerId=null
   * - Impersonation: actorId = impersonatorId, userId = sub (the target)
   */
  private buildPayload(
    user: AuthUser,
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
    event: {
      action: string;
      actionType: AuditEventPayload['actionType'];
      entityType: string;
      entityId: string | null;
      changes: AuditEventPayload['changes'];
      metadata: AuditEventPayload['metadata'];
      correlationId: string;
      subjectTenantId: string | null;
    },
  ): AuditEventPayload {
    const base = {
      action: event.action,
      actionType: event.actionType,
      entityType: event.entityType,
      entityId: event.entityId,
      changes: event.changes,
      metadata: event.metadata,
      correlationId: event.correlationId,
      ipAddress: req.ip ?? null,
      userAgent: (req.headers?.['user-agent'] as string) ?? null,
      source: 'GATEWAY' as const,
      // Actor tracking — CRITICAL for impersonation
      userId: user.userId,
      actorId: user.isImpersonated ? (user.impersonatorId ?? user.userId) : user.userId,
      impersonatorId: user.isImpersonated ? (user.impersonatorId ?? null) : null,
      impersonationSessionId: user.impersonationSessionId ?? null,
      syntheticOrigin: isSyntheticContext(user) ? user.syntheticOrigin : null,
    };

    switch (user.scope) {
      case 'platform':
        return {
          ...base,
          scope: 'platform',
          tenantId: null,
          resellerId: null,
          subjectTenantId: event.subjectTenantId,
        };
      case 'reseller':
        return {
          ...base,
          scope: 'reseller',
          tenantId: null,
          resellerId: user.resellerId,
          subjectTenantId: event.subjectTenantId,
        };
      case 'institute':
        return { ...base, scope: 'institute', tenantId: user.tenantId, resellerId: null };
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The institute id at `path` in the mutation arguments; null unless it is a UUID. */
export function readInstituteId(args: unknown, path: string | undefined): string | null {
  if (!path) return null;
  let value: unknown = args;
  for (const key of path.split('.')) {
    if (typeof value !== 'object' || value === null) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' && UUID.test(value) ? value : null;
}
