import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthRepositoryModule } from '../auth/repositories/auth-repository.module';
import { PasskeyResolver } from './passkey.resolver';
import { PasskeyService } from './passkey.service';
import { PasskeyRepositoryModule } from './repositories/passkey-repository.module';

@Module({
  imports: [PasskeyRepositoryModule, AuthRepositoryModule, AuthModule],
  providers: [PasskeyService, PasskeyResolver],
})
export class PasskeyModule {}
