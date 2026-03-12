import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '@roviq/nestjs-prisma';
import { TelemetryModule } from '@roviq/telemetry';
import { validate } from '../config/env.validation';
import { NatsModule } from '../nats/nats.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TelemetryModule,
    PrismaModule,
    NatsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
