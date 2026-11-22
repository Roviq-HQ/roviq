import type { DevicePlatform } from '@roviq/common-types';

/** Writes keyed by the caller's own user id from the token; nothing here takes it from input. */
export abstract class DeviceTokenRepository {
  abstract register(userId: string, token: string, platform: DevicePlatform): Promise<void>;
  abstract unregister(userId: string, token: string): Promise<void>;
}
