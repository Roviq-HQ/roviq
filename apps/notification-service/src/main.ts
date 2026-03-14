import type { NatsConnection } from '@nats-io/nats-core';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { MicroserviceOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { ensureConsumers } from './nats/ensure-consumers';
import { NATS_CONNECTION } from './nats/nats.provider';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const nc = app.get<NatsConnection>(NATS_CONNECTION);
  await ensureConsumers(nc);

  const config = app.get(ConfigService);

  // Hybrid app: HTTP + NATS microservice for billing event consumption
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: [config.get<string>('NATS_URL', 'nats://localhost:4222')],
      queue: 'notification-service',
    },
  });
  await app.startAllMicroservices();

  const port = config.get<number>('NOTIFICATION_SERVICE_PORT', 3002);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Notification service is running on: http://localhost:${port}`);
}

bootstrap();
