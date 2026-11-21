import '@testing-library/jest-dom/vitest';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import messagesEn from '../../../../messages/en/resellerInstitutes.json';
import { FirstAdminCard, type InstituteFirstAdmin } from '../first-admin-card';

const labels = messagesEn.detail.firstAdmin;

function renderCard(firstAdmin: InstituteFirstAdmin | null) {
  render(
    <FirstAdminCard
      firstAdmin={firstAdmin}
      labels={labels}
      testId={testIds.resellerInstituteDetail.firstAdminCard}
    />,
  );
}

const FULL: InstituteFirstAdmin = {
  firstName: 'Meera',
  lastName: 'Joshi',
  email: 'meera@sunrise.example',
  phone: '9812345678',
  detailsWithheld: false,
};

describe('FirstAdminCard', () => {
  it('should show the name, email and an Indian mobile with +91', () => {
    renderCard(FULL);

    expect(screen.getByText('Meera Joshi')).toBeInTheDocument();
    expect(screen.getByText(FULL.email)).toBeInTheDocument();
    expect(screen.getByText('+91 9812345678')).toBeInTheDocument();
    expect(screen.queryByText(labels.withheld)).not.toBeInTheDocument();
  });

  it('should not add +91 to a number that already has a country code', () => {
    renderCard({ ...FULL, phone: '+447700900123' });

    expect(screen.getByText('+447700900123')).toBeInTheDocument();
    expect(screen.queryByText(/\+91/)).not.toBeInTheDocument();
  });

  it('should show the email as the name when the account has no name', () => {
    renderCard({ ...FULL, firstName: null, lastName: null });

    expect(screen.getAllByText(FULL.email)).toHaveLength(2);
  });

  it('should show only the email and the withheld note when details are withheld', () => {
    renderCard({
      firstName: null,
      lastName: null,
      email: FULL.email,
      phone: null,
      detailsWithheld: true,
    });

    expect(screen.getByText(FULL.email)).toBeInTheDocument();
    expect(screen.getByText(labels.withheld)).toBeInTheDocument();
    expect(screen.queryByText(labels.name)).not.toBeInTheDocument();
    expect(screen.queryByText(labels.phone)).not.toBeInTheDocument();
    expect(screen.queryByText(/\+91/)).not.toBeInTheDocument();
  });

  it('should say none was recorded when there is no first admin', () => {
    renderCard(null);

    expect(screen.getByText(labels.none)).toBeInTheDocument();
  });
});
