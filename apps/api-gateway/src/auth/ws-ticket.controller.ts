import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthUser } from '@roviq/common-types';
import { REDIS_CLIENT } from '@roviq/redis';
import type Redis from 'ioredis';
import { issueWsTicket } from './ws-ticket.store';

@Controller('auth')
export class WsTicketController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Get('ws-ticket')
  @UseGuards(AuthGuard('jwt'))
  async getWsTicket(@Req() req: { user: AuthUser }): Promise<{ ticket: string }> {
    return { ticket: await issueWsTicket(this.redis, req.user) };
  }
}
