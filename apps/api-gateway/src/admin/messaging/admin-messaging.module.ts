import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingTokenCipher } from '@roviq/crypto';
import { AdminMessagingResolver } from './admin-messaging.resolver';
import { AdminMessagingService } from './admin-messaging.service';
import { AdminMessagingRepositoryModule } from './repositories/admin-messaging-repository.module';

@Module({
  imports: [AdminMessagingRepositoryModule],
  providers: [
    {
      provide: MessagingTokenCipher,
      useFactory: (config: ConfigService) =>
        new MessagingTokenCipher(config.getOrThrow<string>('MESSAGING_ENCRYPTION_KEY')),
      inject: [ConfigService],
    },
    AdminMessagingService,
    AdminMessagingResolver,
  ],
})
export class AdminMessagingModule {}
