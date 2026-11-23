import crypto from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { serializeRequest, serializeResponse } from './redaction';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isDev = config.get<string>('NODE_ENV') !== 'production';
        return {
          pinoHttp: {
            level: config.get<string>('LOG_LEVEL', 'info'),
            transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
            genReqId: (req) => req.headers['x-request-id']?.toString() || crypto.randomUUID(),
            serializers: { req: serializeRequest, res: serializeResponse },
            // Suppress successful request logs in dev (errors still logged)
            autoLogging: isDev ? { ignore: (req) => req.url === '/api/graphql' } : true,
          },
          forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
          exclude: [{ method: RequestMethod.ALL, path: 'health' }],
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class TelemetryModule {}
