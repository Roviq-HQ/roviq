import crypto from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          transport:
            config.get<string>('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
          genReqId: (req: { headers: Record<string, string | undefined> }) =>
            req.headers['x-request-id'] || crypto.randomUUID(),
        },
        exclude: [{ method: RequestMethod.ALL, path: 'health' }],
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class TelemetryModule {}
