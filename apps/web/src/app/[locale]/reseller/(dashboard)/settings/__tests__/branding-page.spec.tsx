import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { GraphQLError } from 'graphql';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResellerBrandingPage from '../branding/page';
import { ResellerUpdateBrandingDocument } from '../use-reseller-settings.generated';
import { buildImage, buildProfile, FULL_ADMIN, profileMock, VIEWER } from './fixtures';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The real field talks to storage; its own spec covers that. Here a button stands for a finished upload.
vi.mock('@web/components/file-upload/file-upload', () => ({
  FileUpload: ({
    name,
    label,
    onChange,
  }: {
    name: string;
    label: string;
    onChange: (fileIds: string[]) => void;
  }) => (
    <button type="button" data-testid={`upload-${name}`} onClick={() => onChange([`new-${name}`])}>
      {label}
    </button>
  ),
}));

function updateMock(input: Record<string, unknown>, profile: ReturnType<typeof buildProfile>) {
  return {
    request: { query: ResellerUpdateBrandingDocument, variables: { input } },
    result: { data: { resellerUpdateBranding: profile } },
  };
}

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ResellerBrandingPage', () => {
  it('shows the stored branding, the upload placeholder and a sandboxed preview', async () => {
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: FULL_ADMIN,
    });

    expect(await screen.findByTestId('reseller-settings-primary-color-input')).toHaveValue(
      '#0F766E',
    );
    expect(screen.getByTestId('reseller-settings-secondary-color-input')).toHaveValue('');
    expect(screen.getByTestId('reseller-settings-theme-select')).toHaveTextContent('Dark');
    expect(screen.getByTestId('upload-reseller-logo')).toHaveTextContent('Logo');
    expect(screen.getByTestId('upload-reseller-favicon')).toHaveTextContent('Favicon');
    expect(screen.getByTestId('reseller-settings-branding-not-applied')).toBeInTheDocument();

    const preview = screen.getByTestId('reseller-settings-branding-preview');
    expect(preview).toHaveAttribute('sandbox', '');
    expect(preview.getAttribute('srcdoc')).toContain('--brand-primary:#0F766E');
    expect(preview.getAttribute('srcdoc')).toContain('Acme Partners');
    expect(screen.getByTestId('reseller-settings-branding-save-btn')).toBeDisabled();
  });

  it('updates the preview as the colour is typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: FULL_ADMIN,
    });

    const primary = await screen.findByTestId('reseller-settings-primary-color-input');
    await user.clear(primary);
    await user.type(primary, '#112233');

    await waitFor(() =>
      expect(
        screen.getByTestId('reseller-settings-branding-preview').getAttribute('srcdoc'),
      ).toContain('--brand-primary:#112233'),
    );
  });

  it('refuses a colour that is not six-digit hex', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: FULL_ADMIN,
    });

    const secondary = await screen.findByTestId('reseller-settings-secondary-color-input');
    await user.type(secondary, 'blue');

    expect(
      await screen.findByText('Enter a six-digit hex colour, such as #1677FF.'),
    ).toBeInTheDocument();
    vi.mocked(toast.error).mockClear();
    const save = screen.getByTestId('reseller-settings-branding-save-btn');
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(secondary).toHaveFocus());
    expect(screen.getByText('Enter a six-digit hex colour, such as #1677FF.')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('names the forbidden construct in a stylesheet and keeps it out of the preview', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: FULL_ADMIN,
    });

    const css = await screen.findByTestId('reseller-settings-custom-css-input');
    await user.click(css);
    await user.paste('.a { background: url(https://evil.example/p.png); }');

    expect(await screen.findByTestId('reseller-settings-custom-css-error')).toHaveTextContent(
      'Remove "url(". Styles cannot load files from other sites or contain HTML.',
    );
    expect(
      screen.getByTestId('reseller-settings-branding-preview').getAttribute('srcdoc'),
    ).not.toContain('evil.example');
    vi.mocked(toast.error).mockClear();
    await user.click(screen.getByTestId('reseller-settings-branding-save-btn'));

    await waitFor(() => expect(css).toHaveFocus());
    expect(screen.getByTestId('reseller-settings-custom-css-error')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('saves the edited values under the loaded version, sending null for a cleared colour', async () => {
    const user = userEvent.setup();
    const saved = buildProfile({
      version: 5,
      branding: {
        __typename: 'ResellerBrandingModel',
        primaryColor: null,
        secondaryColor: null,
        theme: 'DARK',
        customCss: '.brand-card { border-radius: 0; }',
      },
    });
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [
        profileMock(buildProfile()),
        updateMock(
          {
            version: 4,
            primaryColor: null,
            secondaryColor: null,
            theme: 'DARK',
            customCss: '.brand-card { border-radius: 0; }',
          },
          saved,
        ),
      ],
      abilityRules: FULL_ADMIN,
    });

    await screen.findByTestId('reseller-settings-primary-color-input');
    await user.click(screen.getByTestId('reseller-settings-primary-color-reset-btn'));
    const css = screen.getByTestId('reseller-settings-custom-css-input');
    await user.click(css);
    await user.paste('.brand-card { border-radius: 0; }');
    await user.click(screen.getByTestId('reseller-settings-branding-save-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changes saved'));
    await waitFor(() =>
      expect(screen.getByTestId('reseller-settings-branding-save-btn')).toBeDisabled(),
    );
    expect(screen.getByTestId('reseller-settings-primary-color-input')).toHaveValue('');
  });

  it('sends a newly uploaded logo with the save and leaves the favicon out', async () => {
    const user = userEvent.setup();
    const saved = buildProfile({ version: 5, logo: buildImage() });
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [
        profileMock(buildProfile()),
        updateMock(
          {
            version: 4,
            primaryColor: '#0F766E',
            secondaryColor: null,
            theme: 'DARK',
            customCss: null,
            logoFileId: 'new-reseller-logo',
          },
          saved,
        ),
      ],
      abilityRules: FULL_ADMIN,
    });

    await user.click(await screen.findByTestId('upload-reseller-logo'));
    expect(screen.getByTestId('reseller-settings-branding-save-btn')).toBeEnabled();
    await user.click(screen.getByTestId('reseller-settings-branding-save-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changes saved'));
    expect(
      await screen.findByTestId('reseller-settings-branding-current-logo'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('upload-reseller-logo')).toHaveTextContent('Replace Logo');
    expect(
      screen.getByTestId('reseller-settings-branding-preview').getAttribute('srcdoc'),
    ).toContain('class="brand-logo-image"');
    await waitFor(() =>
      expect(screen.getByTestId('reseller-settings-branding-save-btn')).toBeDisabled(),
    );
  });

  it('removes the stored logo only after Remove is confirmed by saving, and lets it be kept', async () => {
    const user = userEvent.setup();
    const withLogo = buildProfile({ logo: buildImage() });
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [
        profileMock(withLogo),
        updateMock(
          {
            version: 4,
            primaryColor: '#0F766E',
            secondaryColor: null,
            theme: 'DARK',
            customCss: null,
            logoFileId: null,
          },
          buildProfile({ version: 5 }),
        ),
      ],
      abilityRules: FULL_ADMIN,
    });

    await user.click(await screen.findByTestId('reseller-settings-branding-remove-logo-btn'));
    expect(screen.getByText('Will be removed when you save.')).toBeInTheDocument();
    expect(
      screen.getByTestId('reseller-settings-branding-preview').getAttribute('srcdoc'),
    ).not.toContain('brand-logo-image" src');

    await user.click(screen.getByTestId('reseller-settings-branding-keep-logo-btn'));
    expect(screen.getByTestId('reseller-settings-branding-save-btn')).toBeDisabled();

    await user.click(screen.getByTestId('reseller-settings-branding-remove-logo-btn'));
    await user.click(screen.getByTestId('reseller-settings-branding-save-btn'));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Changes saved'));
    await waitFor(() =>
      expect(
        screen.queryByTestId('reseller-settings-branding-current-logo'),
      ).not.toBeInTheDocument(),
    );
  });

  it('shows translated copy when the server refuses the uploaded image', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [
        profileMock(buildProfile()),
        {
          request: {
            query: ResellerUpdateBrandingDocument,
            variables: {
              input: {
                version: 4,
                primaryColor: '#0F766E',
                secondaryColor: null,
                theme: 'DARK',
                customCss: null,
                faviconFileId: 'new-reseller-favicon',
              },
            },
          },
          result: {
            errors: [new GraphQLError('bad', { extensions: { code: 'FILE_IMAGE_INVALID' } })],
          },
        },
      ],
      abilityRules: FULL_ADMIN,
    });

    await user.click(await screen.findByTestId('upload-reseller-favicon'));
    await user.click(screen.getByTestId('reseller-settings-branding-save-btn'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(/image/i);
  });

  it('explains a lost race and reloads the latest version', async () => {
    const user = userEvent.setup();
    const latest = buildProfile({ version: 9 });
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [
        profileMock(buildProfile()),
        {
          request: {
            query: ResellerUpdateBrandingDocument,
            variables: {
              input: {
                version: 4,
                primaryColor: null,
                secondaryColor: null,
                theme: 'DARK',
                customCss: null,
              },
            },
          },
          result: {
            errors: [
              new GraphQLError('stale', { extensions: { code: 'CONCURRENT_MODIFICATION' } }),
            ],
          },
        },
        profileMock(latest),
      ],
      abilityRules: FULL_ADMIN,
    });

    await screen.findByTestId('reseller-settings-primary-color-input');
    await user.click(screen.getByTestId('reseller-settings-primary-color-reset-btn'));
    await user.click(screen.getByTestId('reseller-settings-branding-save-btn'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Someone else changed these settings. The latest version has been loaded; make your change again.',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('reseller-settings-primary-color-input')).toHaveValue('#0F766E'),
    );
  });

  it('is read-only for a role that cannot update the reseller', async () => {
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [profileMock(buildProfile())],
      abilityRules: VIEWER,
    });

    expect(await screen.findByTestId('reseller-settings-read-only-notice')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-settings-primary-color-input')).toBeDisabled();
    expect(screen.getByTestId('reseller-settings-custom-css-input')).toBeDisabled();
    expect(screen.queryByTestId('reseller-settings-branding-save-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('upload-reseller-logo')).not.toBeInTheDocument();
    expect(screen.getByTestId('reseller-settings-branding-no-logo')).toHaveTextContent('None set.');
  });

  it('offers a retry when the settings cannot be loaded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResellerBrandingPage />, {
      apolloMocks: [
        { request: profileMock(buildProfile()).request, error: new Error('network') },
        profileMock(buildProfile()),
      ],
      abilityRules: FULL_ADMIN,
    });

    await user.click(await screen.findByTestId('reseller-settings-retry-btn'));
    expect(await screen.findByTestId('reseller-settings-primary-color-input')).toHaveValue(
      '#0F766E',
    );
  });
});
