import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthRepositoryModule } from './repositories/auth-repository.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), AuthRepositoryModule, AuditModule],
  providers: [AuthService, AuthResolver, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
