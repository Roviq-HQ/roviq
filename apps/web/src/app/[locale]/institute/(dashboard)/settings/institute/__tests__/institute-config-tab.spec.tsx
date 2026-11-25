/**
 * The configuration form is filled from the query; Apollo's objects carry `__typename`, which the
 * update input refuses, so saving any change failed.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import type { MyInstituteData } from '../types';

const updateConfigMock = vi.fn();
vi.mock('../use-institute-settings', () => ({
  useUpdateInstituteConfig: () => [updateConfigMock, { loading: false }],
}));
vi.mock('../institute-languages', () => ({ InstituteLanguages: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InstituteConfigTab } from '../institute-config-tab';

const INSTITUTE: MyInstituteData['myInstitute'] = {
  __typename: 'InstituteModel',
  id: 'inst-1',
  name: { en: 'Test Institute' },
  slug: 'test-institute',
  type: 'SCHOOL',
  status: 'ACTIVE',
  setupStatus: 'COMPLETED',
  structureFramework: 'NEP',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  defaultLocale: 'en',
  supportedLocales: ['en', 'hi'],
  settings: {},
  contact: { emails: [], phones: [] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  config: {
    __typename: 'InstituteConfigModel',
    id: 'cfg-1',
    attendanceType: 'DAILY',
    openingTime: '07:30',
    closingTime: '14:00',
    shifts: [{ __typename: 'ShiftConfigModel', name: 'Morning', start: '07:30', end: '14:00' }],
    termStructure: [
      {
        __typename: 'TermConfigModel',
        label: 'Term 1',
        startDate: '2026-04-01',
        endDate: '2026-09-30',
      },
    ],
    sectionStrengthNorms: {
      __typename: 'SectionStrengthNormsModel',
      optimal: 40,
      hardMax: 45,
      exemptionAllowed: true,
    },
  },
};

describe('InstituteConfigTab', () => {
  beforeEach(() => {
    updateConfigMock.mockReset();
    updateConfigMock.mockResolvedValue({ data: {} });
  });

  it('saves a changed norm without the query objects’ __typename', async () => {
    renderWithProviders(<InstituteConfigTab institute={INSTITUTE} loading={false} />);
    const optimal = await screen.findByRole('spinbutton', { name: /optimal strength/i });
    await userEvent.clear(optimal);
    await userEvent.type(optimal, '30');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateConfigMock).toHaveBeenCalledTimes(1));
    const { input } = updateConfigMock.mock.calls[0][0].variables;
    expect(JSON.stringify(input)).not.toContain('__typename');
    expect(input).toMatchObject({
      shifts: [{ name: 'Morning', start: '07:30', end: '14:00' }],
      termStructure: [{ label: 'Term 1', startDate: '2026-04-01', endDate: '2026-09-30' }],
      sectionStrengthNorms: { optimal: 30, hardMax: 45, exemptionAllowed: true },
    });
  });
});
