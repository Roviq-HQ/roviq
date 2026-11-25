import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';

const NAMED_TENANT = '01a2b3c4-0000-7000-8000-0000000000a1';
const GONE_TENANT = '7c1e0000-0000-7000-8000-0000000000a2';

const message = (
  id: string,
  tenantId: string | null,
  tenantName: Record<string, string> | null,
) => ({
  id,
  originalSubject: 'STUDENT.enrolled',
  originStream: 'STUDENT',
  payload: {},
  error: 'handler failed',
  retryCount: 3,
  correlationId: `corr-${id}`,
  tenantId,
  tenantName,
  failedAt: '2026-05-04T09:00:00.000Z',
  status: 'PENDING',
  replayedAt: null,
  replayCount: 0,
});

vi.mock('../../_lib/dlq.graphql', () => ({
  useDlqMessages: () => ({
    messages: [
      message('m-1', NAMED_TENANT, { en: 'Sunrise Public', hi: 'सनराइज़ पब्लिक' }),
      message('m-2', GONE_TENANT, null),
      message('m-3', null, null),
    ],
    totalCount: 3,
    hasNextPage: false,
    loading: false,
    error: undefined,
    loadMore: vi.fn(),
    refetch: vi.fn(),
  }),
  useReplayDlqMessage: () => [vi.fn(), { loading: false }],
  useDiscardDlqMessage: () => [vi.fn(), { loading: false }],
}));

import { DlqTab } from '../dlq-tab';

function renderTab(locale: 'en' | 'hi' = 'en') {
  return renderWithProviders(
    <NuqsTestingAdapter>
      <DlqTab />
    </NuqsTestingAdapter>,
    { locale },
  );
}

describe('DlqTab institute column (ROV-360)', () => {
  it('shows the institute name, in Hindi too', () => {
    renderTab('hi');
    expect(screen.getByText('सनराइज़ पब्लिक')).toBeInTheDocument();
    expect(screen.getByText('अज्ञात संस्थान')).toBeInTheDocument();
  });

  it('says "Unknown institute" with the id to copy, never a shortened id', async () => {
    const user = userEvent.setup();
    renderTab();

    expect(screen.getByText('Unknown institute')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(GONE_TENANT.slice(0, 8));
    expect(screen.queryByTestId(testIds.copyId.button(NAMED_TENANT))).not.toBeInTheDocument();

    await user.click(screen.getByTestId(testIds.copyId.button(GONE_TENANT)));
    expect(await navigator.clipboard.readText()).toBe(GONE_TENANT);
    // Copying must not open the message sheet.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
