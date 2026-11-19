import { Injectable } from '@nestjs/common';
import {
  BusinessException,
  ErrorCode,
  type FilePurpose,
  type ResellerContext,
} from '@roviq/common-types';
import type { ResellerBranding } from '@roviq/database';
import { EventBusService } from '@roviq/event-bus';
import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import { FileService } from '../../files/file.service';
import type { ResellerUpdateBrandingInput } from './dto/reseller-update-branding.input';
import type { ResellerUpdateProfileInput } from './dto/reseller-update-profile.input';
import {
  type ResellerFileChanges,
  type ResellerRecord,
  type ResellerSelfPatch,
  ResellerSettingsRepository,
} from './repositories/reseller-settings.repository';

const BRANDING_KEYS = ['primaryColor', 'secondaryColor', 'theme', 'customCss'] as const;

/** Applies the edited keys over the stored branding; keys the editor does not own are kept. */
export function mergeBranding(
  stored: ResellerBranding | null,
  input: Pick<ResellerUpdateBrandingInput, (typeof BRANDING_KEYS)[number]>,
): ResellerBranding {
  const next: ResellerBranding = { ...(stored ?? {}) };
  for (const key of BRANDING_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (value === null || value === '') delete next[key];
    else Object.assign(next, { [key]: value });
  }
  return next;
}

@Injectable()
export class ResellerSettingsService {
  constructor(
    private readonly repo: ResellerSettingsRepository,
    private readonly eventBus: EventBusService,
    private readonly files: FileService,
  ) {}

  async getProfile(ctx: ResellerContext): Promise<ResellerRecord> {
    const record = await this.repo.findOwn(ctx);
    if (!record) {
      throw new BusinessException(ErrorCode.RESELLER_NOT_FOUND, 'Reseller not found');
    }
    return record;
  }

  async updateProfile(
    ctx: ResellerContext,
    input: ResellerUpdateProfileInput,
  ): Promise<ResellerRecord> {
    const current = await this.getProfile(ctx);
    const { version, ...fields } = input;

    // GraphQL lets a nullable field arrive as null; the two columns below are NOT NULL.
    const name = fields.name ?? undefined;
    const contact = fields.contact ?? undefined;

    if (current.isSystem && name !== undefined && name !== current.name) {
      throw new BusinessException(
        ErrorCode.SYSTEM_RESELLER_PROTECTED,
        'The system reseller "Roviq Direct" cannot be renamed',
      );
    }

    const patch: ResellerSelfPatch = {};
    if (name !== undefined) patch.name = name;
    if (fields.registrationNumber !== undefined)
      patch.registrationNumber = fields.registrationNumber;
    if (fields.registrationState !== undefined) patch.registrationState = fields.registrationState;
    if (contact !== undefined) patch.contact = contact;
    if (fields.address !== undefined) patch.address = fields.address;

    return this.save(ctx, version, patch);
  }

  async updateBranding(
    ctx: ResellerContext,
    input: ResellerUpdateBrandingInput,
  ): Promise<ResellerRecord> {
    const current = await this.getProfile(ctx);
    const { version, logoFileId, faviconFileId, ...fields } = input;
    const patch: ResellerSelfPatch = { branding: mergeBranding(current.branding, fields) };
    const changes: ResellerFileChanges = { attach: [], detach: [] };

    // undefined keeps the file, null removes it, an id replaces it.
    const slots = [
      { column: 'logoFileId', purpose: 'RESELLER_LOGO', next: logoFileId },
      { column: 'faviconFileId', purpose: 'RESELLER_FAVICON', next: faviconFileId },
    ] as const satisfies readonly {
      column: 'logoFileId' | 'faviconFileId';
      purpose: FilePurpose;
      next: string | null | undefined;
    }[];
    for (const { column, purpose, next } of slots) {
      const stored = current[column];
      if (next === undefined || next === stored) continue;
      // Storage work happens before the transaction; the row and the files then change together.
      if (next) {
        await this.files.verifyUploads([next], purpose);
        changes.attach.push({ fileId: next, purpose });
      }
      if (stored) changes.detach.push(stored);
      patch[column] = next;
    }

    return this.save(ctx, version, patch, changes);
  }

  private async save(
    ctx: ResellerContext,
    version: number,
    patch: ResellerSelfPatch,
    files?: ResellerFileChanges,
  ): Promise<ResellerRecord> {
    const updated = await this.repo.updateOwn(ctx, version, patch, files);
    if (!updated) {
      throw new BusinessException(
        ErrorCode.CONCURRENT_MODIFICATION,
        'Reseller was modified by someone else. Refresh and try again.',
      );
    }
    const counts = await this.repo.countOwn(ctx);
    this.eventBus.emit(EVENT_PATTERNS.RESELLER.updated, {
      ...updated,
      ...counts,
      actorId: ctx.userId,
      scope: 'platform',
    });
    return updated;
  }
}
