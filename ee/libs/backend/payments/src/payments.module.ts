import { Module } from '@nestjs/common';
import { PlatformDatabaseModule } from '@roviq/nestjs-prisma';
import { PaymentGatewayFactory } from './factory/payment-gateway.factory';

@Module({
  imports: [PlatformDatabaseModule],
  providers: [PaymentGatewayFactory],
  exports: [PaymentGatewayFactory],
})
export class PaymentsModule {}
