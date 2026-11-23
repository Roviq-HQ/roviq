import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { connectJetStreamMicroservice, STREAMS } from '@roviq/nats-jetstream';
import { enableGracefulShutdown } from '@roviq/telemetry';
import { Runtime } from '@temporalio/worker';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';

async function bootstrap() {
  // enableGracefulShutdown owns SIGTERM/SIGINT and stops the worker in onModuleDestroy; Temporal's
  // own handlers would stop it first, and the worker would schedule a restart.
  Runtime.install({ shutdownSignals: [] });
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  enableGracefulShutdown(app);
  const config = app.get(ConfigService);

  connectJetStreamMicroservice(app, {
    servers: [config.get<string>('NATS_URL', 'nats://localhost:4222')],
    streams: Object.values(STREAMS),
    dlq: { enabled: true },
  });
  await app.startAllMicroservices();

  const port = config.get<number>('NOTIFICATION_SERVICE_PORT', 3002);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Notification service is running on: http://localhost:${port}`);
}

bootstrap();
