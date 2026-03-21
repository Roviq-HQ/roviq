import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { AuthResolver } from './auth.resolver';
import { AuthService } from './auth.service';
import { AuthEventService } from './auth-event.service';
import { ImpersonationResolver } from './impersonation.resolver';
import { ImpersonationService } from './impersonation.service';
import { JwtStrategy } from './jwt.strategy';
import { AuthRepositoryModule } from './repositories/auth-repository.module';
import { WsTicketController } from './ws-ticket.controller';

@Module({
  imports: [PassportModule, JwtModule.register({}), AuthRepositoryModule, AuditModule],
  controllers: [WsTicketController],
  providers: [
    AuthService,
    AuthEventService,
    AuthResolver,
    ImpersonationService,
    ImpersonationResolver,
    JwtStrategy,
  ],
  exports: [AuthService, AuthEventService, ImpersonationService],
})
export class AuthModule {}
