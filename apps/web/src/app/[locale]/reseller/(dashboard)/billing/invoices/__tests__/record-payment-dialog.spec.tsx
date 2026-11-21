import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';
import { RecordPaymentDialog } from '../record-payment-dialog';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@roviq/graphql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/graphql')>()),
  useMutation: () => [mutate, { loading: false }],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('RecordPaymentDialog', () => {
  it('has no "Collected by" field and sends no collectedById for cash', async () => {
    mutate.mockResolvedValue({ data: {} });
    renderWithProviders(
      <RecordPaymentDialog open onOpenChange={vi.fn()} invoiceId="inv-1" remainingPaise={117882} />,
    );

    expect(screen.queryByLabelText(/collected by/i)).not.toBeInTheDocument();
    expect(
      screen.getByText('This cash payment is recorded as collected by you.'),
    ).toBeInTheDocument();

    // jsdom's step check rejects 1178.82 (float), which real browsers accept
    const record = screen.getByRole<HTMLButtonElement>('button', { name: 'Record Payment' });
    if (record.form) fireEvent.submit(record.form);

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { input } = mutate.mock.calls[0][0].variables;
    expect(input).toEqual({
      method: 'CASH',
      amountPaise: '117882',
      receiptNumber: undefined,
      notes: undefined,
      collectionDate: new Date().toISOString().split('T')[0],
    });
    expect(input).not.toHaveProperty('collectedById');
  });
});
