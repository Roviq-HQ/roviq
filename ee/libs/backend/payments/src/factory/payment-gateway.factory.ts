import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ADMIN_PRISMA_CLIENT } from '@roviq/nestjs-prisma';
import type { AdminPrismaClient } from '@roviq/prisma-client';
import { CashfreeAdapter } from '../adapters/cashfree.adapter';
import { RazorpayAdapter } from '../adapters/razorpay.adapter';
import type { PaymentGateway } from '../ports/payment-gateway.port';

@Injectable()
export class PaymentGatewayFactory {
  private readonly adapters = new Map<string, PaymentGateway>();

  constructor(
    private readonly config: ConfigService,
    @Inject(ADMIN_PRISMA_CLIENT) private readonly prisma: AdminPrismaClient,
  ) {}

  async getForOrganization(organizationId: string): Promise<PaymentGateway> {
    const gwConfig = await this.prisma.paymentGatewayConfig.findUniqueOrThrow({
      where: { organizationId },
    });
    return this.getForProvider(gwConfig.provider as 'CASHFREE' | 'RAZORPAY');
  }

  getForProvider(provider: 'CASHFREE' | 'RAZORPAY'): PaymentGateway {
    let adapter = this.adapters.get(provider);
    if (!adapter) {
      if (provider === 'RAZORPAY') {
        adapter = new RazorpayAdapter(this.config);
      } else if (provider === 'CASHFREE') {
        adapter = new CashfreeAdapter(this.config);
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }
      this.adapters.set(provider, adapter);
    }
    return adapter;
  }
}
