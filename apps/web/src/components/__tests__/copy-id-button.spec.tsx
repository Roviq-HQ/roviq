import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../__test-utils__/render-with-providers';
import { CopyIdButton } from '../copy-id-button';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ID = '01a2b3c4-d5e6-7f80-9a0b-1c2d3e4f5a6b';

describe('CopyIdButton', () => {
  beforeEach(() => vi.mocked(toast.success).mockClear());

  it('copies the full id and confirms in Hindi', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CopyIdButton value={ID} name="आवेदन आईडी" rowKey="row-1" />, {
      locale: 'hi',
    });

    const button = screen.getByTestId(testIds.copyId.button('row-1', ID));
    expect(button).toHaveAccessibleName('आवेदन आईडी कॉपी करें');
    await user.click(button);

    expect(await navigator.clipboard.readText()).toBe(ID);
    expect(toast.success).toHaveBeenCalledWith('कॉपी हो गया!', { duration: 2000 });
  });

  it('says how to copy by hand when the browser refuses the clipboard', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'));
    renderWithProviders(<CopyIdButton value={ID} name="application ID" rowKey="row-1" />);

    await user.click(screen.getByTestId(testIds.copyId.button('row-1', ID)));

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't copy. Allow clipboard access for this site, or select the text and copy it.",
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
