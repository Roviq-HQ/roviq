import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../../../__test-utils__/render-with-providers';
import { BrandingImageField, type BrandingImageValue } from '../branding-image-field';

const { instituteSettings: ids } = testIds;

const picked = new File(['logo'], 'logo.png', { type: 'image/png' });

// Stands in for the real upload box: one button finishes an upload, another takes it back.
vi.mock('@web/components/file-upload/file-upload', () => ({
  FileUpload: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (fileIds: string[], files: File[]) => void;
  }) => (
    <div>
      <span>{label}</span>
      <button type="button" onClick={() => onChange(['file-new'], [picked])}>
        finish upload
      </button>
      <button type="button" onClick={() => onChange([], [])}>
        take back upload
      </button>
    </div>
  ),
}));

const saved = { url: 'https://files.example/logo/md.webp', width: 512, height: 256 };

describe('BrandingImageField', () => {
  const onChange = vi.fn<(value: BrandingImageValue, file?: File) => void>();

  beforeEach(() => {
    onChange.mockReset();
  });

  function renderField(props: {
    current?: typeof saved | null;
    value?: BrandingImageValue;
    editable?: boolean;
  }) {
    return renderWithProviders(
      <BrandingImageField
        name="logo"
        purpose="INSTITUTE_LOGO"
        label="Logo"
        description="Shown in the header."
        current={props.current ?? null}
        value={props.value}
        onChange={onChange}
        onBusyChange={vi.fn()}
        editable={props.editable ?? true}
        round={0}
      />,
    );
  }

  it('should show the saved image with a remove action and offer to replace it', async () => {
    renderField({ current: saved });

    expect(screen.getByTestId(ids.brandingImageCurrent('logo'))).toBeInTheDocument();
    expect(screen.getByText('Replace Logo')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(ids.brandingImageRemoveBtn('logo')));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('should hide the image once it is marked for removal and let the user keep it', async () => {
    renderField({ current: saved, value: null });

    expect(screen.queryByTestId(ids.brandingImageCurrent('logo'))).not.toBeInTheDocument();
    expect(screen.getByTestId(ids.brandingImageRemoveNote('logo'))).toHaveTextContent(
      'Logo will be removed when you save.',
    );
    await userEvent.click(screen.getByTestId(ids.brandingImageUndoBtn('logo')));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('should report a finished upload with its file', async () => {
    renderField({});

    await userEvent.click(screen.getByRole('button', { name: 'finish upload' }));

    expect(onChange).toHaveBeenCalledWith('file-new', picked);
  });

  it('should fall back to the saved image when the new upload is taken back', async () => {
    renderField({ current: saved, value: 'file-new' });

    await userEvent.click(screen.getByRole('button', { name: 'take back upload' }));

    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('should not change a pending removal when the empty upload box reports nothing', async () => {
    renderField({ current: saved, value: null });

    await userEvent.click(screen.getByRole('button', { name: 'take back upload' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('should show a read-only user the image and nothing to change it with', () => {
    renderField({ current: saved, editable: false });

    expect(screen.getByTestId(ids.brandingImageCurrent('logo'))).toBeInTheDocument();
    expect(screen.queryByTestId(ids.brandingImageRemoveBtn('logo'))).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'finish upload' })).not.toBeInTheDocument();
  });
});
