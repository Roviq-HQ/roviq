import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  institutes,
  institutesLive,
  mkResellerCtx,
  withReseller,
} from '@roviq/database';
import { invoices, payments } from '@roviq/ee-database';
import { getRequestContext } from '@roviq/request-context';
import { and, count, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from 'drizzle-orm';

@Injectable()
export class PaymentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  private get userId(): string {
    return getRequestContext().userId;
  }

  async create(resellerId: string, data: typeof payments.$inferInsert) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const [payment] = await tx.insert(payments).values(data).returning();
      return payment;
    });
  }

  /**
   * Records a captured gateway payment that has no order row, and applies it to the invoice in
   * the same transaction. Idempotent on `gatewayPaymentId`: a repeat returns the stored row.
   */
  async recordGatewayPayment(resellerId: string, data: typeof payments.$inferInsert) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const [created] = await tx
        .insert(payments)
        .values(data)
        .onConflictDoNothing({
          target: payments.gatewayPaymentId,
          where: sql`gateway_payment_id IS NOT NULL`,
        })
        .returning();
      if (created) {
        const credit = await applyToInvoice(tx, created, data.updatedBy);
        return { payment: created, credit, created: true };
      }
      const [existing] = await tx
        .select()
        .from(payments)
        .where(eq(payments.gatewayPaymentId, data.gatewayPaymentId ?? ''))
        .limit(1);
      return { payment: existing, credit: null, created: false };
    });
  }

  async findById(resellerId: string, id: string) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).limit(1);
      return payment ?? null;
    });
  }

  async update(resellerId: string, id: string, data: Partial<typeof payments.$inferInsert>) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const [payment] = await tx
        .update(payments)
        .set({ ...data, updatedAt: new Date(), updatedBy: this.userId })
        .where(eq(payments.id, id))
        .returning();
      return payment;
    });
  }

  /** Latest gateway order still waiting for payment on this invoice. */
  async findOpenGatewayPayment(resellerId: string, invoiceId: string) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.invoiceId, invoiceId),
            eq(payments.status, 'PENDING'),
            isNotNull(payments.gatewayOrderId),
          ),
        )
        .orderBy(desc(payments.createdAt))
        .limit(1);
      return payment ?? null;
    });
  }

  /**
   * Marks the payment row of a gateway order as captured and adds it to the invoice, in one
   * transaction. The row may be PENDING, or FAILED when a newer order replaced it but the payer
   * still paid the old one. Browser verify and the webhook can race: only one settles; the other
   * gets `settled: false` with the stored row. Returns null when the order has no payment row.
   */
  async settleGatewayOrder(
    resellerId: string,
    input: {
      gatewayOrderId: string;
      gatewayPaymentId: string;
      /** Only settle a payment of this institute */
      tenantId?: string;
      gatewayResponse?: unknown;
      /** Webhooks run without a user and pass the system user */
      actorId: string;
    },
  ) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const scope: SQL[] = [eq(payments.gatewayOrderId, input.gatewayOrderId)];
      if (input.tenantId) scope.push(eq(payments.tenantId, input.tenantId));

      const [settled] = await tx
        .update(payments)
        .set({
          status: 'SUCCEEDED',
          gatewayPaymentId: input.gatewayPaymentId,
          ...(input.gatewayResponse !== undefined && { gatewayResponse: input.gatewayResponse }),
          paidAt: new Date(),
          failedAt: null,
          failureReason: null,
          updatedAt: new Date(),
          updatedBy: input.actorId,
        })
        .where(
          and(
            ...scope,
            inArray(payments.status, ['PENDING', 'FAILED']),
            isNull(payments.gatewayPaymentId),
          ),
        )
        .returning();
      if (settled) {
        const credit = await applyToInvoice(tx, settled, input.actorId);
        return { payment: settled, credit, settled: true };
      }

      const [existing] = await tx
        .select()
        .from(payments)
        .where(and(...scope, eq(payments.gatewayPaymentId, input.gatewayPaymentId)))
        .limit(1);
      return existing ? { payment: existing, credit: null, settled: false } : null;
    });
  }

  /** Name and primary contact of an institute, for the gateway checkout form. */
  async findPayer(resellerId: string, tenantId: string) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const [institute] = await tx
        .select({ name: institutesLive.name, contact: institutesLive.contact })
        .from(institutesLive)
        .where(eq(institutesLive.id, tenantId))
        .limit(1);
      return institute ?? null;
    });
  }

  async findByGatewayOrderId(resellerId: string, gatewayOrderId: string) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      return tx
        .select()
        .from(payments)
        .where(eq(payments.gatewayOrderId, gatewayOrderId))
        .orderBy(desc(payments.createdAt));
    });
  }

  async findByInvoiceId(resellerId: string, invoiceId: string) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      return tx
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, invoiceId))
        .orderBy(desc(payments.createdAt));
    });
  }

  async findByTenantId(
    resellerId: string,
    tenantId: string,
    params: { first: number; after?: string },
  ) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const conditions: SQL[] = [eq(payments.tenantId, tenantId)];

      if (params.after) {
        const [cursor] = await tx
          .select({ createdAt: payments.createdAt, id: payments.id })
          .from(payments)
          .where(eq(payments.id, params.after))
          .limit(1);
        if (cursor) {
          conditions.push(
            sql`(${payments.createdAt}, ${payments.id}) < (${cursor.createdAt}, ${cursor.id})`,
          );
        }
      }

      const where = and(...conditions);

      const [items, [{ total }]] = await Promise.all([
        tx
          .select()
          .from(payments)
          .where(where)
          .orderBy(desc(payments.createdAt), desc(payments.id))
          .limit(params.first),
        tx.select({ total: count() }).from(payments).where(where),
      ]);

      return { items, totalCount: total };
    });
  }

  /** Find payment by UTR number — for duplicate UTR check */
  async findByUtrNumber(resellerId: string, utrNumber: string) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const [payment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.utrNumber, utrNumber))
        .limit(1);
      return payment ?? null;
    });
  }

  /** Find payments pending UPI verification for a reseller */
  async findUnverified(resellerId: string, params: { first: number; after?: string }) {
    return withReseller(this.db, mkResellerCtx(resellerId, 'repository:payment'), async (tx) => {
      const conditions: SQL[] = [eq(payments.verificationStatus, 'PENDING_VERIFICATION')];

      if (params.after) {
        const [cursor] = await tx
          .select({ createdAt: payments.createdAt, id: payments.id })
          .from(payments)
          .where(eq(payments.id, params.after))
          .limit(1);
        if (cursor) {
          conditions.push(
            sql`(${payments.createdAt}, ${payments.id}) < (${cursor.createdAt}, ${cursor.id})`,
          );
        }
      }

      const where = and(...conditions);

      const [rows, [{ total }]] = await Promise.all([
        tx
          .select({
            payment: payments,
            invoiceNumber: invoices.invoiceNumber,
            instituteName: institutes.name,
          })
          .from(payments)
          // Left joins under the reseller's RLS: an invoice or institute it cannot read stays null.
          .leftJoin(invoices, eq(invoices.id, payments.invoiceId))
          .leftJoin(institutes, eq(institutes.id, payments.tenantId)) // allow-base-read: a payment keeps its institute's name after the institute is deleted
          .where(where)
          .orderBy(desc(payments.createdAt), desc(payments.id))
          .limit(params.first),
        tx.select({ total: count() }).from(payments).where(where),
      ]);

      const items = rows.map(({ payment, invoiceNumber, instituteName }) => ({
        ...payment,
        invoiceNumber,
        instituteName,
      }));
      return { items, totalCount: total };
    });
  }
}

/** Invoice statuses that can take a payment; DRAFT is not issued yet. */
export const PAYABLE_INVOICE_STATUSES: ReadonlySet<string> = new Set([
  'SENT',
  'PARTIALLY_PAID',
  'OVERDUE',
]);

/**
 * Adds a captured payment to its invoice. The money always counts towards `paidAmount`, but only
 * a payable invoice changes status: a late capture must not reopen a cancelled or refunded one.
 */
async function applyToInvoice(
  tx: DrizzleDB,
  payment: { invoiceId: string; amountPaise: bigint },
  actorId: string,
) {
  // Row lock: two captures for one invoice must add up, not overwrite each other.
  const [current] = await tx
    .select()
    .from(invoices)
    .where(eq(invoices.id, payment.invoiceId))
    .for('update');
  if (!current) return null;

  const paidAmount = current.paidAmount + payment.amountPaise;
  const payable = PAYABLE_INVOICE_STATUSES.has(current.status);
  const becamePaid = payable && paidAmount >= current.totalAmount;
  const [invoice] = await tx
    .update(invoices)
    .set({
      paidAmount,
      ...(payable && { status: becamePaid ? 'PAID' : 'PARTIALLY_PAID' }),
      ...(becamePaid && { paidAt: new Date() }),
      updatedAt: new Date(),
      updatedBy: actorId,
    })
    .where(eq(invoices.id, current.id))
    .returning();
  return {
    invoice,
    becamePaid,
    statusBefore: current.status,
    overpaidPaise: paidAmount > current.totalAmount ? paidAmount - current.totalAmount : 0n,
  };
}
