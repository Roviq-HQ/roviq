import type { InstituteLocaleSettings } from '@roviq/common-types';
import type {
  InstituteRecord,
  UpdateInstituteBrandingData,
  UpdateInstituteConfigData,
  UpdateInstituteInfoData,
} from './types';

/**
 * The caller's own institute, read and written as the institute database role. No method takes
 * an institute id: the institute is the one in the request context, and row security refuses
 * every other row.
 */
export abstract class OwnInstituteRepository {
  abstract find(): Promise<InstituteRecord | null>;
  /** `null` when the row changed since `data.version` was read. */
  abstract updateInfo(data: UpdateInstituteInfoData): Promise<InstituteRecord | null>;
  /** `null` when the row changed since `version` was read. */
  abstract updateLocales(
    settings: InstituteLocaleSettings,
    version: number,
  ): Promise<InstituteRecord | null>;
  abstract updateBranding(data: UpdateInstituteBrandingData): Promise<InstituteRecord | null>;
  abstract updateConfig(data: UpdateInstituteConfigData): Promise<InstituteRecord | null>;
}
