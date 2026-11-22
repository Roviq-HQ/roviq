import 'json-bigint-patch';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { validationExceptionFactory } from '@roviq/common-types';
import { enableGracefulShutdown } from '@roviq/telemetry';
import { Runtime } from '@temporalio/worker';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';

async function bootstrap() {
  // enableGracefulShutdown owns SIGTERM/SIGINT and stops the workers in onModuleDestroy; Temporal's
  // own handlers would stop them first, and the workers would schedule a restart.
  Runtime.install({ shutdownSignals: [] });
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  app.useLogger(app.get(Logger));
  enableGracefulShutdown(app);
  // Cover body-parser failures and paths outside the global API prefix.
  const correlationIdMiddleware = app.get(CorrelationIdMiddleware);
  app.use(correlationIdMiddleware.use.bind(correlationIdMiddleware));

  const config = app.get(ConfigService);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  app.use(helmet());

  app.enableCors({
    origin: config.getOrThrow<string>('ALLOWED_ORIGINS').split(','),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  const port = config.get<number>('API_GATEWAY_PORT', 3000);
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`Application is running on: http://localhost:${port}/${globalPrefix}`);
}

bootstrap();
