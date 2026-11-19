import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { ProfilePhotoButton } from '../profile-photo-button';

const setPhoto = vi.fn();
const refetchQueries = vi.fn();
vi.mock('@roviq/graphql', async () => {
  const actual = await vi.importActual<typeof import('@roviq/graphql')>('@roviq/graphql');
  return {
    ...actual,
    useMutation: () => [setPhoto, { loading: false }],
    useApolloClient: () => ({ refetchQueries }),
  };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function renderButton(hasPhoto: boolean) {
  renderWithProviders(
    <ProfilePhotoButton
      kind="student"
      profileId="student-1"
      userId="user-1"
      name="Priya Singh"
      hasPhoto={hasPhoto}
    />,
  );
  return userEvent.setup();
}

describe('ProfilePhotoButton', () => {
  beforeEach(() => {
    setPhoto.mockReset().mockResolvedValue({ data: { setStudentPhoto: true } });
    refetchQueries.mockReset().mockResolvedValue([]);
  });

  it('should open a dialog named after the person, with saving disabled until a photo is uploaded', async () => {
    const user = renderButton(false);

    await user.click(screen.getByTestId('profile-photo-change-btn'));

    expect(
      await screen.findByRole('heading', { name: 'Profile picture of Priya Singh' }),
    ).toBeVisible();
    expect(screen.getByTestId('profile-photo-save-btn')).toBeDisabled();
  });

  it('should not offer removal when there is no picture', async () => {
    const user = renderButton(false);

    await user.click(screen.getByTestId('profile-photo-change-btn'));

    await screen.findByTestId('profile-photo-dialog');
    expect(screen.queryByTestId('profile-photo-remove-btn')).not.toBeInTheDocument();
  });

  it('should remove the picture, reload what is on screen and close', async () => {
    const user = renderButton(true);
    await user.click(screen.getByTestId('profile-photo-change-btn'));

    await user.click(await screen.findByTestId('profile-photo-remove-btn'));

    expect(setPhoto).toHaveBeenCalledWith({ variables: { id: 'student-1', fileId: null } });
    await waitFor(() => expect(refetchQueries).toHaveBeenCalledWith({ include: 'active' }));
    await waitFor(() =>
      expect(screen.queryByTestId('profile-photo-dialog')).not.toBeInTheDocument(),
    );
  });

  it('should keep the dialog open when saving fails', async () => {
    setPhoto.mockRejectedValue(new Error('network'));
    const user = renderButton(true);
    await user.click(screen.getByTestId('profile-photo-change-btn'));

    await user.click(await screen.findByTestId('profile-photo-remove-btn'));

    await waitFor(() => expect(setPhoto).toHaveBeenCalled());
    expect(screen.getByTestId('profile-photo-dialog')).toBeInTheDocument();
    expect(refetchQueries).not.toHaveBeenCalled();
  });
});
