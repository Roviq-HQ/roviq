import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DB,
  type DrizzleDB,
  mkResellerCtx,
  namedColumns,
  withReseller,
} from '@roviq/database';
import { gatewayConfigs, gatewayConfigsLive, payments } from '@roviq/ee-database';
import { getRequestContext } from '@roviq/request-context';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { billingError } from '../billing.errors';

/** Every column of a gateway config as of today; its readers decrypt and mask the secrets. */
export const GATEWAY_CONFIG_COLUMNS = [
  'id',
  'resellerId',
  'provider',
  'status',
  'displayName',
  'isDefault',
  'credentials',
  'webhookSecret',
  'testMode',
  'supportedMethods',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'deletedAt',
  'deletedBy',
  'version',
] as const;

@Injectable()
export class GatewayConfigRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: DrizzleDB) {}

  private get userId(): string {
    return getRequestContext().userId;
  }

  async findByResellerId(resellerId: string) {
    return withReseller(
      this.db,
      mkResellerCtx(resellerId, 'repository:gateway-config'),
      async (tx) => {
        return tx
          .select(namedColumns(gatewayConfigsLive, GATEWAY_CONFIG_COLUMNS))
          .from(gatewayConfigsLive)
          .orderBy(desc(gatewayConfigsLive.createdAt));
      },
    );
  }

  async findById(resellerId: string, id: string) {
    return withReseller(
      this.db,
      mkResellerCtx(resellerId, 'repository:gateway-config'),
      async (tx) => {
        const [config] = await tx
          .select(namedColumns(gatewayConfigsLive, GATEWAY_CONFIG_COLUMNS))
          .from(gatewayConfigsLive)
          .where(eq(gatewayConfigsLive.id, id))
          .limit(1);
        return config ?? null;
      },
    );
  }

  async create(resellerId: string, data: typeof gatewayConfigs.$inferInsert) {
    return withReseller(
      this.db,
      mkResellerCtx(resellerId, 'repository:gateway-config'),
      async (tx) => {
        if (data.isDefault) await this.clearDefault(tx, resellerId);
        const [config] = await tx
          .insert(gatewayConfigs)
          .values(data)
          .returning(namedColumns(gatewayConfigs, GATEWAY_CONFIG_COLUMNS));
        return config;
      },
    );
  }

  async update(resellerId: string, id: string, data: Partial<typeof gatewayConfigs.$inferInsert>) {
    return withReseller(
      this.db,
      mkResellerCtx(resellerId, 'repository:gateway-config'),
      async (tx) => {
        // Lookup through the live view to skip soft-deleted rows; the UPDATE
        // itself targets the base table since views are read-only.
        const [existing] = await tx
          .select({ id: gatewayConfigsLive.id })
          .from(gatewayConfigsLive)
          .where(eq(gatewayConfigsLive.id, id))
          .limit(1);
        if (!existing) return undefined;

        if (data.isDefault) await this.clearDefault(tx, resellerId);
        const [config] = await tx
          .update(gatewayConfigs)
          .set({ ...data, updatedAt: new Date(), updatedBy: this.userId })
          .where(eq(gatewayConfigs.id, id))
          .returning(namedColumns(gatewayConfigs, GATEWAY_CONFIG_COLUMNS));
        return config;
      },
    );
  }

  /** Only one live config per reseller may be the default (`gwc_reseller_default_key`). */
  private async clearDefault(tx: DrizzleDB, resellerId: string) {
    await tx
      .update(gatewayConfigs)
      .set({ isDefault: false, updatedAt: new Date(), updatedBy: this.userId })
      .where(
        and(
          eq(gatewayConfigs.resellerId, resellerId),
          eq(gatewayConfigs.isDefault, true),
          isNull(gatewayConfigs.deletedAt),
        ),
      );
  }

  async softDelete(resellerId: string, id: string) {
    return withReseller(
      this.db,
      mkResellerCtx(resellerId, 'repository:gateway-config'),
      async (tx) => {
        const [config] = await tx
          .select(namedColumns(gatewayConfigsLive, GATEWAY_CONFIG_COLUMNS))
          .from(gatewayConfigsLive)
          .where(eq(gatewayConfigsLive.id, id))
          .limit(1);
        if (!config) billingError('GATEWAY_CONFIG_NOT_FOUND', 'Gateway config not found');

        const [{ pendingCount }] = await tx
          .select({ pendingCount: count() })
          .from(payments)
          .where(
            and(
              eq(payments.resellerId, resellerId),
              eq(payments.gatewayProvider, config.provider),
              eq(payments.status, 'PENDING'),
            ),
          );
        if (pendingCount > 0) {
          billingError(
            'PLAN_IN_USE',
            `Cannot delete gateway config with ${pendingCount} pending payment(s)`,
          );
        }

        const [deleted] = await tx
          .update(gatewayConfigs)
          .set({
            deletedAt: new Date(),
            deletedBy: this.userId,
            updatedAt: new Date(),
            updatedBy: this.userId,
          })
          .where(eq(gatewayConfigs.id, id))
          .returning(namedColumns(gatewayConfigs, GATEWAY_CONFIG_COLUMNS));
        return deleted;
      },
    );
  }
}
