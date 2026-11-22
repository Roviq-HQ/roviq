import { describe, expect, it } from 'vitest';
import type { NotificationConfigRecord } from '../../repositories/types';
import { resolveChannelSettings } from '../channel-settings';

const ROW: NotificationConfigRecord = {
  inAppEnabled: false,
  whatsappEnabled: false,
  emailEnabled: true,
  pushEnabled: true,
  digestEnabled: true,
  digestCron: '0 20 * * *',
};

describe('resolveChannelSettings', () => {
  it('should apply the institute row to a regular type', () => {
    expect(
      resolveChannelSettings(
        { ignoresInstituteSettings: false, defaultDigestCron: '0 18 * * *' },
        ROW,
      ),
    ).toEqual({
      inApp: false,
      channels: { EMAIL: true, PUSH: true, SMS: true, WHATSAPP: false },
      digestCron: '0 20 * * *',
    });
  });

  it('should use the defaults when the institute has no row', () => {
    expect(
      resolveChannelSettings(
        { ignoresInstituteSettings: false, defaultDigestCron: '0 18 * * *' },
        null,
      ),
    ).toEqual({
      inApp: true,
      channels: { EMAIL: true, PUSH: false, SMS: true, WHATSAPP: true },
      digestCron: '0 18 * * *',
    });
  });

  it('should send at once when the institute turned the digest off', () => {
    expect(
      resolveChannelSettings(
        { ignoresInstituteSettings: false, defaultDigestCron: '0 18 * * *' },
        { ...ROW, digestEnabled: false },
      ).digestCron,
    ).toBeNull();
  });

  it('should never digest a type that declares no digest', () => {
    expect(
      resolveChannelSettings({ ignoresInstituteSettings: false, defaultDigestCron: null }, ROW)
        .digestCron,
    ).toBeNull();
  });

  it('should ignore the institute row for a critical type', () => {
    expect(
      resolveChannelSettings({ ignoresInstituteSettings: true, defaultDigestCron: null }, ROW),
    ).toEqual({
      inApp: true,
      channels: { EMAIL: true, PUSH: true, SMS: true, WHATSAPP: true },
      digestCron: null,
    });
  });
});
