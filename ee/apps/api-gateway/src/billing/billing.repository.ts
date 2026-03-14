import { accessibleBy } from '@casl/prisma';
import { Inject, Injectable } from '@nestjs/common';
import type { AppAbility } from '@roviq/common-types';
import { ADMIN_PRISMA_CLIENT } from '@roviq/nestjs-prisma';
import type {
  AdminPrismaClient,
  InvoiceStatus,
  PaymentProvider,
  Prisma,
  SubscriptionStatus,
} from '@roviq/prisma-client';

function abilityWhereInput(ability: AppAbility, action: string, model: Prisma.ModelName) {
  // biome-ignore lint/suspicious/noExplicitAny: bridging MongoAbility → PrismaAbility (runtime-compatible, verified by tests)
  return accessibleBy(ability as any, action)[model];
}

@Injectable()
export class BillingRepository {
  constructor(@Inject(ADMIN_PRISMA_CLIENT) private readonly prisma: AdminPrismaClient) {}

  // ---------------------------------------------------------------------------
  // Plans
  // ---------------------------------------------------------------------------

  async createPlan(data: Prisma.SubscriptionPlanCreateInput) {
    return this.prisma.subscriptionPlan.create({ data });
  }

  async updatePlan(id: string, data: Prisma.SubscriptionPlanUpdateInput) {
    return this.prisma.subscriptionPlan.update({ where: { id }, data });
  }

  async findAllPlans(ability?: AppAbility) {
    return this.prisma.subscriptionPlan.findMany({
      where: ability ? abilityWhereInput(ability, 'read', 'SubscriptionPlan') : {},
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPlanById(id: string, ability?: AppAbility) {
    return this.prisma.subscriptionPlan.findFirst({
      where: {
        AND: [{ id }, ability ? abilityWhereInput(ability, 'read', 'SubscriptionPlan') : {}],
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  async createSubscription(data: Prisma.SubscriptionUncheckedCreateInput) {
    return this.prisma.subscription.create({ data, include: { plan: true } });
  }

  async updateSubscription(id: string, data: Prisma.SubscriptionUpdateInput) {
    return this.prisma.subscription.update({ where: { id }, data });
  }

  async updateSubscriptionWithPlan(id: string, data: Prisma.SubscriptionUpdateInput) {
    return this.prisma.subscription.update({
      where: { id },
      data,
      include: { plan: true },
    });
  }

  async findSubscriptionById(id: string, ability?: AppAbility) {
    return this.prisma.subscription.findFirst({
      where: {
        AND: [{ id }, ability ? abilityWhereInput(ability, 'read', 'Subscription') : {}],
      },
    });
  }

  async findSubscriptionByOrg(organizationId: string, ability?: AppAbility) {
    return this.prisma.subscription.findFirst({
      where: {
        AND: [
          { organizationId },
          ability ? abilityWhereInput(ability, 'read', 'Subscription') : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
  }

  async findSubscriptionByProviderId(providerSubscriptionId: string) {
    return this.prisma.subscription.findFirst({
      where: { providerSubscriptionId },
    });
  }

  async findAllSubscriptions(params: {
    filter?: { status?: SubscriptionStatus };
    first: number;
    after?: string;
    ability?: AppAbility;
  }) {
    const conditions: Prisma.SubscriptionWhereInput[] = [];
    if (params.filter?.status) conditions.push({ status: params.filter.status });
    if (params.ability) conditions.push(abilityWhereInput(params.ability, 'read', 'Subscription'));

    const where: Prisma.SubscriptionWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    const cursor = params.after ? { id: params.after } : undefined;
    const skip = cursor ? 1 : 0;

    const [items, totalCount] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        take: params.first,
        skip,
        cursor,
        orderBy: { createdAt: 'desc' },
        include: { organization: { select: { id: true, name: true } }, plan: true },
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return { items, totalCount };
  }

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------

  async createInvoice(data: Prisma.InvoiceUncheckedCreateInput) {
    return this.prisma.invoice.create({ data });
  }

  async findInvoiceByProviderPaymentId(providerPaymentId: string) {
    return this.prisma.invoice.findFirst({ where: { providerPaymentId } });
  }

  async findInvoices(params: {
    organizationId?: string;
    filter?: { status?: InvoiceStatus; from?: Date; to?: Date };
    first: number;
    after?: string;
    ability?: AppAbility;
  }) {
    const conditions: Prisma.InvoiceWhereInput[] = [];
    if (params.organizationId) conditions.push({ organizationId: params.organizationId });
    if (params.filter?.status) conditions.push({ status: params.filter.status });
    if (params.filter?.from || params.filter?.to) {
      conditions.push({
        createdAt: {
          ...(params.filter.from && { gte: params.filter.from }),
          ...(params.filter.to && { lte: params.filter.to }),
        },
      });
    }
    if (params.ability) conditions.push(abilityWhereInput(params.ability, 'read', 'Invoice'));

    const where: Prisma.InvoiceWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    const cursor = params.after ? { id: params.after } : undefined;
    const skip = cursor ? 1 : 0;

    const [items, totalCount] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        take: params.first,
        skip,
        cursor,
        orderBy: { createdAt: 'desc' },
        include: {
          subscription: {
            select: {
              id: true,
              organization: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { items, totalCount };
  }

  // ---------------------------------------------------------------------------
  // Payment Infrastructure
  // ---------------------------------------------------------------------------

  async upsertGatewayConfig(organizationId: string, provider: PaymentProvider) {
    return this.prisma.paymentGatewayConfig.upsert({
      where: { organizationId },
      create: {
        organizationId,
        provider,
        isActive: true,
      },
      update: { provider, isActive: true },
    });
  }

  async findOrganizationById(id: string) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id } });
  }

  async findAllOrganizations() {
    return this.prisma.organization.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  async findPaymentEvent(providerEventId: string) {
    return this.prisma.paymentEvent.findUnique({ where: { providerEventId } });
  }

  async upsertPaymentEvent(data: {
    provider: PaymentProvider;
    eventType: string;
    providerEventId: string;
    subscriptionId?: string | null;
    organizationId?: string | null;
    payload: Record<string, unknown>;
    processedAt: Date;
  }) {
    return this.prisma.paymentEvent.upsert({
      where: { providerEventId: data.providerEventId },
      create: {
        provider: data.provider,
        eventType: data.eventType,
        providerEventId: data.providerEventId,
        subscriptionId: data.subscriptionId,
        organizationId: data.organizationId,
        payload: data.payload as Prisma.InputJsonValue,
        processedAt: data.processedAt,
      },
      update: { processedAt: data.processedAt },
    });
  }

  async claimPaymentEvent(
    providerEventId: string,
    data: {
      provider: PaymentProvider;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<boolean> {
    try {
      await this.prisma.paymentEvent.create({
        data: {
          providerEventId,
          provider: data.provider,
          eventType: data.eventType,
          payload: data.payload as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (error) {
      // P2002 = unique constraint violation — event already claimed
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  async markPaymentEventProcessed(
    providerEventId: string,
    data: {
      subscriptionId?: string;
      organizationId?: string;
    },
  ): Promise<void> {
    await this.prisma.paymentEvent.update({
      where: { providerEventId },
      data: { ...data, processedAt: new Date() },
    });
  }
}
