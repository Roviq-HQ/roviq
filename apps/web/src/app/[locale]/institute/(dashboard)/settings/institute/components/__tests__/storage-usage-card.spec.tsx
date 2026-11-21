import type { MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../../../../../../messages/en/instituteSettings.json';
import { StorageUsageCard } from '../storage-usage-card';
import { InstituteStorageUsageDocument } from '../storage-usage-card.generated';

const { instituteSettings: ids } = testIds;
const copy = messages.storage;
const GB = 1024 ** 3;

const usage = (usedBytes: number, limitBytes: number | null): MockedResponse => ({
  request: { query: InstituteStorageUsageDocument },
  result: { data: { storageUsage: { __typename: 'StorageUsage', usedBytes, limitBytes } } },
});

function renderCard(mock: MockedResponse) {
  render(
    <NextIntlClientProvider locale="en" messages={{ instituteSettings: messages }}>
      <MockedProvider mocks={[mock]}>
        <StorageUsageCard />
      </MockedProvider>
    </NextIntlClientProvider>,
  );
}

describe('StorageUsageCard', () => {
  it('should show usage against the limit without a warning below 80%', async () => {
    renderCard(usage(1.5 * GB, 5 * GB));

    expect(await screen.findByTestId(ids.storageUsed)).toHaveTextContent('1.5 GB of 5 GB used');
    expect(screen.getByTestId(ids.storageBar)).toHaveAccessibleName('Storage used: 30%');
    expect(screen.queryByTestId(ids.storageWarning)).not.toBeInTheDocument();
  });

  it('should warn from 80% of the limit', async () => {
    renderCard(usage(4 * GB, 5 * GB));

    expect(await screen.findByTestId(ids.storageWarning)).toHaveTextContent(copy.nearLimit);
  });

  it('should say uploads are refused once the limit is reached', async () => {
    renderCard(usage(5 * GB, 5 * GB));

    expect(await screen.findByTestId(ids.storageWarning)).toHaveTextContent(copy.atLimit);
  });

  it('should show usage alone, with no bar, when the plan sets no limit', async () => {
    renderCard(usage(200 * 1024 * 1024, null));

    expect(await screen.findByTestId(ids.storageUsed)).toHaveTextContent(
      '200 MB used. Your plan sets no storage limit.',
    );
    expect(screen.queryByTestId(ids.storageBar)).not.toBeInTheDocument();
  });

  it('should say so when usage cannot be loaded', async () => {
    renderCard({
      request: { query: InstituteStorageUsageDocument },
      error: new Error('network down'),
    });

    expect(await screen.findByText(copy.failed)).toBeInTheDocument();
  });
});
