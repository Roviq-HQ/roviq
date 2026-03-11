import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '@roviq/nestjs-prisma';
import { AuthModule } from '../auth/auth.module';
import { PasskeyResolver } from './passkey.resolver';
import { PasskeyService } from './passkey.service';

@Module({
  imports: [PlatformDatabaseModule, AuthModule],
  providers: [PasskeyService, PasskeyResolver],
})
export class PasskeyModule {}
