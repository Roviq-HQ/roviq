import crypto from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule, type Params } from 'nestjs-pino';
import type { Logger } from 'pino';
import { createListedLogger, listedLogSerializers } from './log-fields';

/**
 * How the request logger is set up around `logger`, which must come from
 * `createListedLogger`. `quietGraphql` leaves successful GraphQL requests unlogged.
 */
export function requestLoggerParams(logger: Logger, quietGraphql: boolean): Params {
  return {
    pinoHttp: {
      logger,
      genReqId: (req) => req.headers['x-request-id']?.toString() || crypto.randomUUID(),
      serializers: listedLogSerializers,
      autoLogging: quietGraphql ? { ignore: (req) => req.url === '/api/graphql' } : true,
    },
    forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
    exclude: [{ method: RequestMethod.ALL, path: 'health' }],
  };
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') !== 'production';
        const logger = createListedLogger({
          level: config.get<string>('LOG_LEVEL', 'info'),
          transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
        });
        // Successful GraphQL requests are not logged in dev (errors still are).
        return requestLoggerParams(logger, isDev);
      },
    }),
  ],
  exports: [LoggerModule],
})
export class TelemetryModule {}
