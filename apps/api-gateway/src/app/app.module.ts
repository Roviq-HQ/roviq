import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Logger, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type { AuthUser } from '@roviq/common-types';
import { EeModule } from '@roviq/ee-gateway';
import { EventBusModule } from '@roviq/event-bus';
import { DateOnlyScalar, DateTimeScalar, I18nTextScalar } from '@roviq/nestjs-graphql';
import { REDIS_CLIENT, RedisModule } from '@roviq/redis';
import { StorageModule } from '@roviq/storage';
import { TelemetryModule } from '@roviq/telemetry';
import type Redis from 'ioredis';
import { AdminModule } from '../admin/admin.module';
import {
  ConnectionTracker,
  ConnectionTrackerModule,
  InFlightRequestMiddleware,
} from '../admin/monitoring/connections/connection-tracker';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ImpersonationSessionGuard } from '../auth/middleware/impersonation-session.guard';
import { InstituteAccessGuard } from '../auth/middleware/institute-access.guard';
import { MustChangePasswordGuard } from '../auth/middleware/must-change-password.guard';
import { ResellerAccessGuard } from '../auth/middleware/reseller-access.guard';
import { TenantMiddleware } from '../auth/middleware/tenant.middleware';
import { consumeWsTicket } from '../auth/ws-ticket.store';
import { CaslModule } from '../casl/casl.module';
import { readFieldMiddleware } from '../casl/read-field.middleware';
import { createGraphqlErrorFormatter } from '../common/filters/graphql-error.mapper';
import { GraphqlExceptionFilter } from '../common/filters/graphql-exception.filter';
import { CorrelationIdMiddleware } from '../common/middleware/correlation-id.middleware';
import { validate } from '../config/env.validation';
import { DlqModule } from '../dlq/dlq.module';
import { ProfileImageResolversModule } from '../files/profile-image-resolvers.module';
import { HealthModule } from '../health/health.module';
import { InstituteScopeModule } from '../institute/institute-scope.module';
import { NatsJetStreamModule } from '../nats/nats-jetstream.module';
import { NovuProxyModule } from '../novu-proxy/novu-proxy.module';
import { PasskeyModule } from '../passkey/passkey.module';
import { PublicVerificationModule } from '../public-verification/public-verification.module';
import { ResellerModule } from '../reseller/reseller.module';
import { AppController } from './app.controller';
import { AppResolver } from './app.resolver';
import { AppService } from './app.service';

const wsLogger = new Logger('WsTicketAuth');
const gqlErrorLogger = new Logger('GraphqlErrorFormatter');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    RedisModule,
    StorageModule,
    NatsJetStreamModule,
    EventBusModule,
    TelemetryModule,
    ConnectionTrackerModule,
    // Needed by the global `ImpersonationSessionGuard`, which decodes the
    // Bearer token itself (`JwtService.verify`) rather than reading
    // `req.user` — APP_GUARD runs before passport-jwt populates the user.
    JwtModule.register({}),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 20 }],
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [ConnectionTrackerModule],
      inject: [ConfigService, REDIS_CLIENT, ConnectionTracker],
      useFactory: (config: ConfigService, redis: Redis, connections: ConnectionTracker) => ({
        autoSchemaFile: true,
        buildSchemaOptions: { fieldMiddleware: [readFieldMiddleware] },
        path: 'api/graphql',
        // Our mapper owns the error shape; Nest's built-in transform would
        // re-add `extensions.originalError`.
        autoTransformHttpErrors: false,
        includeStacktraceInErrorResponses: config.get('NODE_ENV') === 'development',
        formatError: createGraphqlErrorFormatter({
          onUnhandled: (thrown) => gqlErrorLogger.error({ err: thrown }, 'Unhandled GraphQL error'),
        }),
        playground: config.get('NODE_ENV') !== 'production',
        introspection: config.get('NODE_ENV') !== 'production',
        subscriptions: {
          'graphql-ws': {
            path: '/api/graphql',
            onConnect: async (ctx) => {
              const user = await consumeWsTicket(redis, ctx.connectionParams?.ticket);
              if (!user) {
                wsLogger.warn(
                  'WebSocket connection rejected: missing, invalid, expired or reused ticket',
                );
                return false;
              }

              const extra = ctx.extra as Record<string, unknown>;
              extra.user = user;
              connections.websocketOpened();
              return true;
            },
            // graphql-ws calls this only for acknowledged connections, mirroring onConnect's increment.
            onDisconnect: () => {
              connections.websocketClosed();
            },
          },
        },
        context: ({ req, extra }: { req?: { user?: AuthUser }; extra?: { user?: AuthUser } }) => {
          // For WebSocket subscriptions, user is on extra.user (set by onConnect)
          // For HTTP requests, user is on req.user (set by Passport)
          if (extra?.user) {
            return { req: { user: extra.user } };
          }
          return { req };
        },
      }),
    }),
    AuthModule,
    CaslModule,
    HealthModule,
    ProfileImageResolversModule,
    AuditModule,
    DlqModule,
    PasskeyModule,
    AdminModule,
    ResellerModule,
    InstituteScopeModule,
    PublicVerificationModule,
    NovuProxyModule,
    EeModule.register(),
  ],
  controllers: [AppController],
  providers: [
    CorrelationIdMiddleware,
    {
      provide: APP_FILTER,
      useClass: GraphqlExceptionFilter,
    },
    AppService,
    AppResolver,
    DateOnlyScalar,
    DateTimeScalar,
    I18nTextScalar,
    {
      provide: APP_GUARD,
      useClass: ImpersonationSessionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ResellerAccessGuard,
    },
    {
      provide: APP_GUARD,
      useClass: InstituteAccessGuard,
    },
    // ROV-96 — first-login enforcement. Runs after JWT auth has populated
    // req.user (or short-circuits when there is no user). Allows handlers
    // marked @AllowWhenPasswordChangeRequired() through; blocks everything
    // else when the access token carries mustChangePassword=true.
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(InFlightRequestMiddleware, TenantMiddleware).forRoutes('*path');
  }
}
