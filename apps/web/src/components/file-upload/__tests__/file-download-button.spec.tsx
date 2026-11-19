import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { FileDownloadButton } from '../file-download-button';

const request = vi.fn();
vi.mock('@roviq/graphql', async () => {
  const actual = await vi.importActual<typeof import('@roviq/graphql')>('@roviq/graphql');
  return { ...actual, useMutation: () => [request, { loading: false }] };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SIGNED_URL = 'https://storage.test/users/u1/user-document/f1.pdf?X-Amz-Expires=60';

interface FakeTab {
  opener: unknown;
  location: { replace: ReturnType<typeof vi.fn> };
  close: ReturnType<typeof vi.fn>;
}

describe('FileDownloadButton', () => {
  let tab: FakeTab;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    request.mockReset();
    tab = { opener: {}, location: { replace: vi.fn() }, close: vi.fn() };
    open = vi.fn().mockReturnValue(tab);
    vi.stubGlobal('open', open);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderButton() {
    renderWithProviders(
      <FileDownloadButton fileId="file-1" label="Page 1" scope="institute" testId="doc-file-1" />,
    );
    return userEvent.setup();
  }

  it('should ask for a link for this file and load it in a new tab cut off from this page', async () => {
    request.mockResolvedValue({ data: { url: SIGNED_URL } });
    const user = renderButton();

    await user.click(screen.getByRole('button', { name: 'Page 1' }));

    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(request).toHaveBeenCalledWith({ variables: { fileId: 'file-1' } });
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(SIGNED_URL));
    expect(tab.opener).toBeNull();
  });

  it('should close the empty tab and say so when the link is refused', async () => {
    request.mockRejectedValue(new Error('FILE_NOT_FOUND'));
    const user = renderButton();

    await user.click(screen.getByRole('button', { name: 'Page 1' }));

    await waitFor(() => expect(tab.close).toHaveBeenCalledOnce());
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Could not open the file. Try again.');
  });
});
