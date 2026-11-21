import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { MockedResponse } from '@apollo/client/testing';
import { MockedProvider } from '@apollo/client/testing/react';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en/adminInstitutes.json';
import { DeletedInstitutesDialog } from '../deleted-institutes-dialog';
import {
  AdminListDeletedInstitutesDocument,
  AdminRestoreInstituteDocument,
} from '../deleted-institutes-dialog.generated';

const { adminInstitutes } = testIds;
const copy = messages.deleted;
const ID = '11111111-1111-4111-a111-111111111111';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@roviq/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/ui')>()),
  Can: ({ children }: { children: React.ReactNode }) => children,
}));

const list = (rows: object[]): MockedResponse => ({
  request: { query: AdminListDeletedInstitutesDocument },
  result: { data: { adminListDeletedInstitutes: rows } },
});
const ROW = {
  id: ID,
  name: { en: 'Saraswati Vidya Mandir' },
  code: 'SVM',
  status: 'ACTIVE',
  deletedAt: '2026-11-21T10:00:00.000Z',
};

function renderDialog(mocks: MockedResponse[], onRestored = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ adminInstitutes: messages }}>
      <MockedProvider mocks={mocks}>
        <DeletedInstitutesDialog onRestored={onRestored} />
      </MockedProvider>
    </NextIntlClientProvider>,
  );
  return onRestored;
}

describe('DeletedInstitutesDialog', () => {
  it('lists deleted institutes with the status they return to, and restores one', async () => {
    const onRestored = renderDialog([
      list([ROW]),
      {
        request: { query: AdminRestoreInstituteDocument, variables: { id: ID } },
        result: { data: { adminRestoreInstitute: { id: ID, status: 'ACTIVE' } } },
      },
      list([]),
    ]);

    await userEvent.click(screen.getByTestId(adminInstitutes.deletedOpenBtn));
    const row = await screen.findByTestId(adminInstitutes.deletedRow(ID));
    expect(row).toHaveTextContent('Saraswati Vidya Mandir');
    expect(row).toHaveTextContent('Code SVM · deleted on 21/11/2026 · returns as Active');

    await userEvent.click(screen.getByTestId(adminInstitutes.deletedRestoreBtn(ID)));

    expect(await screen.findByTestId(adminInstitutes.deletedEmpty)).toHaveTextContent(copy.empty);
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
  });

  it('does not ask the server before it is opened, and says so when nothing is deleted', async () => {
    renderDialog([list([])]);
    expect(screen.queryByTestId(adminInstitutes.deletedDialog)).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId(adminInstitutes.deletedOpenBtn));

    expect(await screen.findByTestId(adminInstitutes.deletedEmpty)).toBeInTheDocument();
  });

  it('keeps the row and does not report success when the restore is refused', async () => {
    const onRestored = renderDialog([
      list([ROW]),
      {
        request: { query: AdminRestoreInstituteDocument, variables: { id: ID } },
        error: new CombinedGraphQLErrors({
          errors: [{ message: 'raw server text', extensions: { code: 'FORBIDDEN' } }],
        }),
      },
      list([ROW]),
    ]);

    await userEvent.click(screen.getByTestId(adminInstitutes.deletedOpenBtn));
    await userEvent.click(await screen.findByTestId(adminInstitutes.deletedRestoreBtn(ID)));

    await waitFor(() =>
      expect(screen.getByTestId(adminInstitutes.deletedRestoreBtn(ID))).toBeEnabled(),
    );
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.queryByText('raw server text')).not.toBeInTheDocument();
  });
});
