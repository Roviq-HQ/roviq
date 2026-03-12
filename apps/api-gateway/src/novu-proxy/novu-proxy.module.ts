import { Module } from '@nestjs/common';
import { NovuProxyController } from './novu-proxy.controller';

@Module({
  controllers: [NovuProxyController],
})
export class NovuProxyModule {}
