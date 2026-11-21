import '@testing-library/jest-dom/vitest';
import assert from 'node:assert';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messagesEn from '../../../../../../../../messages/en/resellerInstitutes.json';

const createRequestMock = vi.fn();

vi.mock('../../use-reseller-institutes', () => ({
  useResellerCreateInstituteRequest: () => [createRequestMock, { loading: false }],
}));

const pushMock = vi.fn();
vi.mock('next/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/navigation')>();
  return {
    ...actual,
    useRouter: () => ({ push: pushMock, back: vi.fn(), replace: vi.fn() }),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { renderWithProviders } from '../../../../../../../__test-utils__/render-with-providers';
import ResellerCreateInstitutePage from '../page';

const copy = messagesEn.create;

async function fillAndSubmit() {
  renderWithProviders(<ResellerCreateInstitutePage />);
  const name = screen
    .getAllByRole('textbox')
    .find((el) => (el as HTMLInputElement).name === 'name.en');
  assert(name);
  await userEvent.type(name, 'Sunrise Academy');
  await userEvent.type(screen.getByLabelText(copy.code), 'SUN-01');
  await userEvent.type(screen.getByLabelText(copy.phoneNumber), '9876512399');
  await userEvent.click(screen.getByLabelText(copy.departmentOptions.PRIMARY));
  await userEvent.click(screen.getByRole('button', { name: copy.submit }));
}

function graphQLError(code: string) {
  return new CombinedGraphQLErrors({
    errors: [{ message: 'raw server text', extensions: { code } }],
  });
}

describe('ResellerCreateInstitutePage', () => {
  beforeEach(() => {
    createRequestMock.mockReset();
    pushMock.mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it('sends the phone with GraphQL field names and enum board and departments', async () => {
    createRequestMock.mockResolvedValue({
      data: { resellerCreateInstituteRequest: { id: 'i-1' } },
    });

    await fillAndSubmit();

    await waitFor(() => expect(createRequestMock).toHaveBeenCalledTimes(1));
    const input = createRequestMock.mock.calls[0]?.[0]?.variables?.input;
    assert(input);
    expect(input.board).toBe('CBSE');
    expect(input.departments).toEqual(['PRIMARY']);
    expect(input.contact).toEqual({
      phones: [
        {
          countryCode: '+91',
          number: '9876512399',
          isPrimary: true,
          isWhatsappEnabled: true,
          label: '',
        },
      ],
      emails: [],
    });
    expect(pushMock).toHaveBeenCalledWith('/reseller/institutes');
  });

  it('shows translated copy for a rejected request, never the server message', async () => {
    createRequestMock.mockRejectedValue(graphQLError('BAD_REQUEST'));

    await fillAndSubmit();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(copy.error, {
        description: copy.errors.invalidInput,
      }),
    );
  });

  it('marks the code as taken when the slug or code already exists', async () => {
    createRequestMock.mockRejectedValue(graphQLError('SLUG_DUPLICATE'));

    await fillAndSubmit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy.codeDuplicate));
    expect(await screen.findAllByText(copy.codeDuplicate)).not.toHaveLength(0);
  });
});
