import { CryptoService } from '@roviq/ee-payments';
import { createMock } from '@roviq/testing';
import { describe, expect, it, vi } from 'vitest';
import { InvoiceFieldResolver } from '../invoice-field.resolver';
import type { InvoiceModel } from '../models/invoice.model';
import { GatewayConfigRepository } from '../repositories/gateway-config.repository';

const RESELLER_ID = 'reseller-1';

type Config = Awaited<ReturnType<GatewayConfigRepository['findByResellerId']>>[number];

function upiConfig(overrides: Partial<Config> = {}) {
  return { provider: 'UPI_DIRECT', status: 'ACTIVE', credentials: 'encrypted', ...overrides };
}

function setup(configs: Partial<Config>[], decrypted: { VPA?: string } = { VPA: 'pay@upi' }) {
  const repo = createMock<GatewayConfigRepository>({
    findByResellerId: vi.fn().mockResolvedValue(configs),
  });
  const crypto = createMock<CryptoService>({ decrypt: vi.fn().mockReturnValue(decrypted) });
  return { resolver: new InvoiceFieldResolver(repo, crypto), crypto };
}

function invoice(overrides: Partial<InvoiceModel> = {}) {
  return createMock<InvoiceModel>({
    resellerId: RESELLER_ID,
    invoiceNumber: 'RVQ-2026-00001',
    status: 'SENT',
    totalAmount: 118000n,
    paidAmount: 18000n,
    ...overrides,
  });
}

describe('InvoiceFieldResolver.resolveUpiPaymentUri', () => {
  it('should build the upi://pay URI from the decrypted VPA and the outstanding balance', async () => {
    const { resolver, crypto } = setup([upiConfig()]);

    const uri = await resolver.resolveUpiPaymentUri(invoice());

    expect(uri).toBe('upi://pay?pa=pay%40upi&pn=Roviq&am=1000.00&tn=INV-RVQ-2026-00001&cu=INR');
    expect(crypto.decrypt).toHaveBeenCalledWith('encrypted');
  });

  it('should return null for a PAID invoice', async () => {
    const { resolver } = setup([upiConfig()]);

    expect(await resolver.resolveUpiPaymentUri(invoice({ status: 'PAID' }))).toBeNull();
  });

  it('should return null when the reseller has no active UPI_DIRECT config', async () => {
    const { resolver } = setup([
      upiConfig({ status: 'INACTIVE' }),
      upiConfig({ provider: 'RAZORPAY' }),
    ]);

    expect(await resolver.resolveUpiPaymentUri(invoice())).toBeNull();
  });

  it('should return null when the credentials carry no VPA', async () => {
    const { resolver } = setup([upiConfig()], {});

    expect(await resolver.resolveUpiPaymentUri(invoice())).toBeNull();
  });
});
