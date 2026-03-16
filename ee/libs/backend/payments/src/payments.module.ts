import { Module } from '@nestjs/common';
import { PaymentGatewayFactory } from './factory/payment-gateway.factory';
import { PaymentGatewayConfigDrizzleRepository } from './repositories/payment-gateway-config.drizzle-repository';
import { PaymentGatewayConfigRepository } from './repositories/payment-gateway-config.repository';

@Module({
  providers: [
    {
      provide: PaymentGatewayConfigRepository,
      useClass: PaymentGatewayConfigDrizzleRepository,
    },
    PaymentGatewayFactory,
  ],
  exports: [PaymentGatewayFactory],
})
export class PaymentsModule {}
