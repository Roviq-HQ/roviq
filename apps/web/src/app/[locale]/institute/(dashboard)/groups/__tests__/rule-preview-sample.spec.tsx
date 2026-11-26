import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import { RulePreviewSample } from '../rule-preview-sample';

const MEMBER = '01a2b3c4-0000-7000-8000-0000000000d1';

describe('RulePreviewSample (ROV-360)', () => {
  it('lists matched students by name and admission number, not membership id', () => {
    renderWithProviders(
      <RulePreviewSample
        members={[
          {
            membershipId: MEMBER,
            firstName: { en: 'Neha', hi: 'नेहा' },
            lastName: { en: 'Gupta', hi: 'गुप्ता' },
            admissionNumber: 'ADM-0007',
          },
        ]}
      />,
      { locale: 'hi' },
    );

    const row = screen.getByTestId(testIds.instituteGroups.previewMember(MEMBER));
    expect(row).toHaveTextContent('नेहा गुप्ता');
    expect(row).toHaveTextContent('एडमिशन नं. ADM-0007');
    expect(row).not.toHaveTextContent(MEMBER);
  });
});
