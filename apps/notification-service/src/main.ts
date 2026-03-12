import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);
  const port = config.get<number>('NOTIFICATION_SERVICE_PORT', 3001);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Notification service is running on: http://localhost:${port}`);
}

bootstrap();
