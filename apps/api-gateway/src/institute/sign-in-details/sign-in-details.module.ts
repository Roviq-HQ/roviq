import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { SignInDetailsService } from './sign-in-details.service';

@Module({
  imports: [AuthModule],
  providers: [SignInDetailsService],
  exports: [SignInDetailsService],
})
export class SignInDetailsModule {}
