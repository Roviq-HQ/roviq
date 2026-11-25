import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingTokenCipher } from '@roviq/crypto';
import { AdminMessagingResolver } from './admin-messaging.resolver';
import { AdminMessagingService } from './admin-messaging.service';
import { AdminMessagingRepositoryModule } from './repositories/admin-messaging-repository.module';
import { WhatsAppAccountCheck } from './whatsapp-account-check';

@Module({
  imports: [AdminMessagingRepositoryModule],
  providers: [
    {
      provide: MessagingTokenCipher,
      useFactory: (config: ConfigService) =>
        new MessagingTokenCipher(config.getOrThrow<string>('MESSAGING_ENCRYPTION_KEY')),
      inject: [ConfigService],
    },
    {
      provide: WhatsAppAccountCheck,
      useFactory: (config: ConfigService) => new WhatsAppAccountCheck(config),
      inject: [ConfigService],
    },
    AdminMessagingService,
    AdminMessagingResolver,
  ],
})
export class AdminMessagingModule {}
