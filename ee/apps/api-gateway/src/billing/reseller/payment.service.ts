import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { i18nDisplay, SYSTEM_USER_ID } from '@roviq/database';
import type { PaymentMethod } from '@roviq/ee-billing-types';
import {
  type CreateOrderInput,
  type CreateOrderResult,
  PaymentGatewayError,
  PaymentGatewayFactory,
} from '@roviq/ee-payments';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS, type EventPattern } from '@roviq/nats-jetstream';
import { getRequestContext } from '@roviq/request-context';
import { billingError } from '../billing.errors';
import { InvoiceRepository } from '../repositories/invoice.repository';
import { PaymentRepository } from '../repositories/payment.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { InvoiceService } from './invoice.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly paymentRepo: PaymentRepository,
    private readonly invoiceRepo: InvoiceRepository,
    private readonly invoiceService: InvoiceService,
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly gatewayFactory: PaymentGatewayFactory,
    private readonly config: ConfigService,
    private readonly eventBus: EventBusService,
  ) {}

  // GraphQL clients subscribe to the aggregate `BILLING.payment.status_changed`
  // subject for any payment lifecycle change. Every specific subject (succeeded
  // / refunded / upi_p2p_*) fans out to it so subscribers don't need to listen
  // to N specific subjects.
  private emitEvent(pattern: EventPattern, data: Record<string, unknown>) {
    this.eventBus.emit(pattern, data);
    if (
      (pattern as string).startsWith('BILLING.payment.') &&
      pattern !== EVENT_PATTERNS.BILLING.payment.status_changed
    ) {
      this.eventBus.emit(EVENT_PATTERNS.BILLING.payment.status_changed, data);
    }
  }

  // ---------------------------------------------------------------------------
  // Gateway payment flow (institute initiates)
  // ---------------------------------------------------------------------------

  async initiatePayment(caller: { resellerId: string; tenantId: string }, invoiceId: string) {
    const { resellerId, tenantId } = caller;
    const invoice = await this.invoiceRepo.findById(resellerId, invoiceId);
    // Another institute's invoice must look unknown.
    if (!invoice || invoice.tenantId !== tenantId) {
      billingError('INVOICE_NOT_FOUND', 'Invoice not found');
    }
    if (['PAID', 'CANCELLED', 'REFUNDED'].includes(invoice.status)) {
      billingError('INVOICE_NOT_PAYABLE', 'Invoice is not payable');
    }

    const gateway = await this.gatewayFactory.create(resellerId);
    const amountPaise = invoice.totalAmount - invoice.paidAmount;
    const orderInput: CreateOrderInput = {
      invoiceId,
      amountPaise,
      currency: invoice.currency,
      customer: await this.payerOf(resellerId, tenantId),
      returnUrl: this.invoiceReturnUrl(invoiceId),
    };

    // Reopen the order of an earlier click instead of leaving another pending payment behind.
    const open = await this.paymentRepo.findOpenGatewayPayment(resellerId, invoiceId);
    if (open?.gatewayOrderId) {
      const existing = await this.callGateway(() =>
        gateway.resumeOrder(open.gatewayOrderId ?? '', orderInput),
      );
      if (existing.state === 'OPEN') {
        return this.checkoutResult(open.id, existing.checkout);
      }
      if (existing.state === 'PAID') {
        billingError(
          'INVOICE_ALREADY_PAID',
          'A payment for this invoice was received and is being confirmed',
        );
      }
      await this.paymentRepo.update(resellerId, open.id, {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: 'Gateway order expired before payment',
      });
    }

    const order = await this.callGateway(() => gateway.createOrder(orderInput));
    const { userId } = getRequestContext();
    const payment = await this.paymentRepo.create(resellerId, {
      invoiceId,
      tenantId,
      resellerId,
      status: 'PENDING',
      method: order.gatewayProvider === 'CASHFREE' ? 'CASHFREE' : 'RAZORPAY',
      amountPaise,
      currency: invoice.currency,
      gatewayProvider: order.gatewayProvider,
      gatewayOrderId: order.gatewayOrderId,
      createdBy: userId,
      updatedBy: userId,
    });

    return this.checkoutResult(payment.id, order);
  }

  async verifyPayment(
    caller: { resellerId: string; tenantId: string },
    input: { gatewayOrderId: string; gatewayPaymentId?: string; signature?: string },
  ) {
    const { resellerId, tenantId } = caller;
    const gateway = await this.gatewayFactory.create(resellerId);
    const verified = await this.callGateway(() => gateway.verifyPayment(input));
    if (!verified) {
      billingError('PAYMENT_VERIFICATION_FAILED', 'The gateway has not confirmed this payment');
    }

    // Scoped to the caller's institute, so another institute's order looks unknown.
    const result = await this.paymentRepo.settleGatewayOrder(resellerId, {
      gatewayOrderId: input.gatewayOrderId,
      gatewayPaymentId: verified.gatewayPaymentId,
      tenantId,
      actorId: getRequestContext().userId,
    });
    if (!result) {
      billingError('PAYMENT_NOT_FOUND', 'No pending payment found for this order');
    }
    if (result.settled) await this.recordCapture(resellerId, result.payment);
    return result.payment;
  }

  private async recordCapture(
    resellerId: string,
    payment: { id: string; invoiceId: string; tenantId: string; amountPaise: bigint },
  ) {
    await this.invoiceService.markPaid(resellerId, payment.invoiceId, payment.amountPaise);
    this.emitEvent(EVENT_PATTERNS.BILLING.payment.succeeded, {
      paymentId: payment.id,
      invoiceId: payment.invoiceId,
      tenantId: payment.tenantId,
      resellerId,
    });
  }

  private checkoutResult(paymentId: string, order: CreateOrderResult) {
    return {
      paymentId,
      gatewayOrderId: order.gatewayOrderId,
      gatewayProvider: order.gatewayProvider,
      checkoutPayload: order.checkoutPayload,
    };
  }

  /** The institute invoice page; Cashfree fills in `{order_id}` when it sends the payer back. */
  private invoiceReturnUrl(invoiceId: string) {
    const url = new URL(
      `/billing/invoices/${invoiceId}`,
      this.config.getOrThrow<string>('BILLING_RETURN_URL'),
    );
    return `${url.toString()}?order_id={order_id}`;
  }

  private async payerOf(resellerId: string, tenantId: string) {
    const institute = await this.paymentRepo.findPayer(resellerId, tenantId);
    if (!institute) billingError('INVOICE_NOT_FOUND', 'Invoice not found');
    const { phones, emails } = institute.contact;
    const phone = phones.find((p) => p.isPrimary) ?? phones[0];
    const email = emails.find((e) => e.isPrimary) ?? emails[0];
    return {
      name: i18nDisplay(institute.name),
      email: email?.address ?? '',
      phone: phone?.number ?? '',
    };
  }

  private async callGateway<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof PaymentGatewayError) {
        this.logger.error(`Payment gateway ${error.provider} failed: ${error.message}`);
        billingError('GATEWAY_ERROR', 'The payment gateway could not be reached');
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Manual payment (reseller records)
  // ---------------------------------------------------------------------------

  async recordManualPayment(
    resellerId: string,
    invoiceId: string,
    input: {
      method: PaymentMethod;
      amountPaise: bigint;
      receiptNumber?: string;
      notes?: string;
      collectedById?: string;
      collectionDate?: string;
    },
  ) {
    const invoice = await this.invoiceRepo.findById(resellerId, invoiceId);
    if (!invoice) billingError('INVOICE_NOT_FOUND', 'Invoice not found');
    if (['PAID', 'CANCELLED', 'REFUNDED'].includes(invoice.status)) {
      billingError('INVOICE_ALREADY_PAID', 'Invoice is not payable');
    }

    const { userId } = getRequestContext();

    const payment = await this.paymentRepo.create(resellerId, {
      invoiceId,
      tenantId: invoice.tenantId,
      resellerId,
      status: 'SUCCEEDED',
      method: input.method,
      amountPaise: input.amountPaise,
      currency: invoice.currency,
      receiptNumber: input.receiptNumber ?? null,
      notes: input.notes ?? null,
      collectedById: input.collectedById ?? null,
      collectionDate: input.collectionDate ?? null,
      paidAt: new Date(),
      createdBy: userId,
      updatedBy: userId,
    });

    // Update invoice paid amount — returns the updated invoice row, which is
    // what the GraphQL resolver exposes (declares `@Mutation(() => InvoiceModel)`).
    const updatedInvoice = await this.invoiceService.markPaid(
      resellerId,
      invoiceId,
      input.amountPaise,
    );

    this.emitEvent(EVENT_PATTERNS.BILLING.payment.succeeded, {
      paymentId: payment.id,
      invoiceId,
      method: input.method,
      amountPaise: Number(input.amountPaise),
      tenantId: invoice.tenantId,
      resellerId,
    });

    // markPaid only returns null if the invoice was deleted between findById
    // above and the update — practically impossible inside a single request.
    // Fall back to a fresh re-read so the resolver never returns null.
    return updatedInvoice ?? (await this.invoiceRepo.findById(resellerId, invoiceId));
  }

  // ---------------------------------------------------------------------------
  // Refund
  // ---------------------------------------------------------------------------

  async issueRefund(
    resellerId: string,
    paymentId: string,
    input: { amountPaise: bigint; reason?: string },
  ) {
    const payment = await this.paymentRepo.findById(resellerId, paymentId);
    if (!payment) billingError('PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.status !== 'SUCCEEDED') {
      billingError('INVOICE_NOT_PAYABLE', 'Can only refund succeeded payments');
    }

    // Validate refund doesn't exceed paid
    const paidAmount = Number(payment.amountPaise);
    const alreadyRefunded = Number(payment.refundedAmountPaise);
    const requestedRefund = Number(input.amountPaise);

    if (alreadyRefunded + requestedRefund > paidAmount) {
      billingError(
        'REFUND_EXCEEDS_PAID',
        `Refund of ₹${requestedRefund / 100} would exceed paid amount of ₹${paidAmount / 100}`,
      );
    }

    // If gateway payment, issue refund through the gateway
    let refundGatewayId: string | null = null;
    if (payment.gatewayPaymentId && payment.gatewayProvider) {
      try {
        const gateway = await this.gatewayFactory.create(resellerId, payment.gatewayProvider);
        const refundResult = await gateway.refundOrder({
          gatewayPaymentId: payment.gatewayPaymentId,
          amountPaise: input.amountPaise,
          reason: input.reason,
        });
        refundGatewayId = refundResult.gatewayRefundId;
      } catch (error) {
        if (error instanceof PaymentGatewayError) {
          billingError('GATEWAY_ERROR', `Gateway refund failed: ${error.message}`);
        }
        throw error;
      }
    }

    const newRefundedTotal = BigInt(alreadyRefunded + requestedRefund);
    const isFullRefund = Number(newRefundedTotal) >= paidAmount;

    const updated = await this.paymentRepo.update(resellerId, paymentId, {
      status: isFullRefund ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      refundedAmountPaise: newRefundedTotal,
      refundedAt: new Date(),
      refundReason: input.reason ?? null,
      refundGatewayId,
    });

    // Update invoice
    await this.invoiceService.markRefunded(resellerId, payment.invoiceId, input.amountPaise);

    this.emitEvent(EVENT_PATTERNS.BILLING.payment.refunded, {
      paymentId,
      invoiceId: payment.invoiceId,
      amountPaise: requestedRefund,
      tenantId: payment.tenantId,
      resellerId,
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Webhook (idempotent)
  // ---------------------------------------------------------------------------

  async handleWebhookPayment(
    resellerId: string,
    input: {
      gatewayPaymentId: string;
      gatewayOrderId?: string;
      invoiceId: string;
      tenantId: string;
      method: PaymentMethod;
      amountPaise: bigint;
      gatewayProvider: string;
      gatewayResponse?: unknown;
    },
  ) {
    // Webhook endpoints are unauthenticated — use system user as the actor
    const userId = getRequestContext().userId || SYSTEM_USER_ID;

    // Usually the browser has already opened a pending row for this order; settle that one.
    if (input.gatewayOrderId) {
      const result = await this.paymentRepo.settleGatewayOrder(resellerId, {
        gatewayOrderId: input.gatewayOrderId,
        gatewayPaymentId: input.gatewayPaymentId,
        gatewayResponse: input.gatewayResponse,
        actorId: userId,
      });
      if (result) {
        if (result.settled) await this.recordCapture(resellerId, result.payment);
        return result.payment;
      }
    }

    const { payment, created } = await this.paymentRepo.findOrCreateByGatewayId(
      resellerId,
      input.gatewayPaymentId,
      {
        invoiceId: input.invoiceId,
        tenantId: input.tenantId,
        resellerId,
        status: 'SUCCEEDED',
        method: input.method,
        amountPaise: input.amountPaise,
        currency: 'INR',
        gatewayProvider: input.gatewayProvider,
        gatewayPaymentId: input.gatewayPaymentId,
        gatewayOrderId: input.gatewayOrderId ?? null,
        gatewayResponse: input.gatewayResponse ?? null,
        paidAt: new Date(),
        createdBy: userId,
        updatedBy: userId,
      },
    );

    if (created) await this.recordCapture(resellerId, payment);
    return payment;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  async getPayment(resellerId: string, id: string) {
    return this.paymentRepo.findById(resellerId, id);
  }

  async getPaymentsByInvoice(resellerId: string, invoiceId: string) {
    return this.paymentRepo.findByInvoiceId(resellerId, invoiceId);
  }

  async getPaymentHistory(
    resellerId: string,
    tenantId: string,
    params: { first: number; after?: string },
  ) {
    return this.paymentRepo.findByTenantId(resellerId, tenantId, params);
  }

  // ---------------------------------------------------------------------------
  // UPI P2P payment flow (institute submits UTR, reseller verifies/rejects)
  // ---------------------------------------------------------------------------

  /**
   * Institute submits a UPI P2P proof with UTR number.
   * Creates a SUCCEEDED payment with PENDING_VERIFICATION status (trust-first).
   * Reactivates PAST_DUE subscriptions immediately.
   */
  async submitUpiProof(
    resellerId: string,
    invoiceId: string,
    utrNumber: string,
    _membershipId: string,
  ) {
    // 1. Validate invoice is payable
    const invoice = await this.invoiceRepo.findById(resellerId, invoiceId);
    if (!invoice) billingError('INVOICE_NOT_FOUND', 'Invoice not found');
    if (!['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)) {
      billingError('INVOICE_NOT_PAYABLE', 'Invoice is not in a payable state');
    }

    // 2. Validate UTR format: 12–22 digits only
    if (!/^\d{12,22}$/.test(utrNumber)) {
      billingError('UTR_INVALID', 'UTR must be 12–22 digits');
    }

    // 3. Check duplicate UTR
    const existingPayment = await this.paymentRepo.findByUtrNumber(resellerId, utrNumber);
    if (existingPayment) {
      billingError('UTR_ALREADY_SUBMITTED', 'A payment with this UTR has already been submitted');
    }

    const { userId } = getRequestContext();
    const remainingPaise = BigInt(Number(invoice.totalAmount) - Number(invoice.paidAmount));

    // 4. Create payment — trust-first: SUCCEEDED with PENDING_VERIFICATION
    const payment = await this.paymentRepo.create(resellerId, {
      invoiceId,
      tenantId: invoice.tenantId,
      resellerId,
      status: 'SUCCEEDED',
      method: 'UPI_P2P',
      amountPaise: remainingPaise,
      currency: invoice.currency,
      utrNumber,
      verificationStatus: 'PENDING_VERIFICATION',
      verificationDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      paidAt: new Date(),
      createdBy: userId,
      updatedBy: userId,
    });

    // 5. Update invoice — increment paidAmount and set status
    await this.invoiceService.markPaid(resellerId, invoiceId, remainingPaise);

    // 6. If subscription was PAST_DUE → reactivate to ACTIVE (trust-first)
    await this.reactivateIfPastDue(resellerId, invoice.tenantId);

    // 7. Emit event
    this.emitEvent(EVENT_PATTERNS.BILLING.payment.upi_p2p_submitted, {
      paymentId: payment.id,
      invoiceId,
      utrNumber,
      tenantId: invoice.tenantId,
      resellerId,
      amountPaise: Number(remainingPaise),
    });

    return payment;
  }

  /**
   * Reseller verifies a UPI P2P payment after confirming UTR in their bank statement.
   */
  async verifyUpiPayment(resellerId: string, paymentId: string, membershipId: string) {
    const payment = await this.paymentRepo.findById(resellerId, paymentId);
    if (!payment) billingError('PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.verificationStatus !== 'PENDING_VERIFICATION') {
      billingError('INVOICE_NOT_PAYABLE', 'Payment is not pending verification');
    }

    const updated = await this.paymentRepo.update(resellerId, paymentId, {
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date(),
      verifiedById: membershipId,
    });

    return updated;
  }

  /**
   * Reseller rejects a UPI P2P payment — full reversal of trust-first changes.
   * Reverts invoice paid amount, invoice status, and subscription status if affected.
   */
  async rejectUpiPayment(resellerId: string, paymentId: string, reason: string) {
    const payment = await this.paymentRepo.findById(resellerId, paymentId);
    if (!payment) billingError('PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.verificationStatus !== 'PENDING_VERIFICATION') {
      billingError('INVOICE_NOT_PAYABLE', 'Payment is not pending verification');
    }

    // 1. Revert invoice — decrement paidAmount by payment amount
    await this.invoiceService.markRefunded(resellerId, payment.invoiceId, payment.amountPaise);

    // 2. Check if subscription needs to revert to PAST_DUE
    await this.revertToPastDueIfNeeded(resellerId, payment.tenantId, payment.invoiceId);

    // 3. Mark payment as FAILED
    const updated = await this.paymentRepo.update(resellerId, paymentId, {
      status: 'FAILED',
      verificationStatus: 'REJECTED',
      failedAt: new Date(),
      failureReason: reason,
    });

    // 4. Emit event
    this.emitEvent(EVENT_PATTERNS.BILLING.payment.upi_p2p_rejected, {
      paymentId,
      invoiceId: payment.invoiceId,
      tenantId: payment.tenantId,
      resellerId,
      reason,
    });

    return updated;
  }

  /**
   * List payments pending UPI verification for a reseller.
   */
  async findUnverifiedPayments(resellerId: string, first: number, after?: string) {
    return this.paymentRepo.findUnverified(resellerId, { first, after });
  }

  // ---------------------------------------------------------------------------
  // Private helpers for UPI P2P flow
  // ---------------------------------------------------------------------------

  /**
   * If the tenant's subscription is PAST_DUE, reactivate it to ACTIVE (trust-first).
   */
  private async reactivateIfPastDue(resellerId: string, tenantId: string) {
    const sub = await this.subscriptionRepo.findActiveByTenant(resellerId, tenantId);
    if (sub && sub.status === 'PAST_DUE') {
      await this.subscriptionRepo.update(resellerId, sub.id, { status: 'ACTIVE' });
      this.logger.log(`Reactivated PAST_DUE subscription ${sub.id} for tenant ${tenantId}`);
    }
  }

  /**
   * After rejecting a UPI payment, check if the invoice is no longer fully paid
   * and if the subscription should revert to PAST_DUE.
   */
  private async revertToPastDueIfNeeded(resellerId: string, tenantId: string, invoiceId: string) {
    // Re-read invoice after reversal
    const invoice = await this.invoiceRepo.findById(resellerId, invoiceId);
    if (!invoice) return;

    // If invoice is no longer fully paid, check subscription status
    if (invoice.status !== 'PAID') {
      const sub = await this.subscriptionRepo.findActiveByTenant(resellerId, tenantId);
      if (sub && sub.status === 'ACTIVE') {
        await this.subscriptionRepo.update(resellerId, sub.id, { status: 'PAST_DUE' });
        this.logger.log(`Reverted subscription ${sub.id} to PAST_DUE for tenant ${tenantId}`);
      }
    }
  }
}
