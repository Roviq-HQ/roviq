import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { FileUpload } from '../file-upload';

const requestUpload = vi.fn();
vi.mock('@roviq/graphql', async () => {
  const actual = await vi.importActual<typeof import('@roviq/graphql')>('@roviq/graphql');
  return { ...actual, useMutation: () => [requestUpload] };
});

const MB = 1024 * 1024;

function pdf(name: string, sizeBytes = 2048): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/pdf' });
}

function renderUpload(props: { maxFiles?: number; onChange?: (ids: string[]) => void } = {}) {
  const onChange = props.onChange ?? vi.fn();
  renderWithProviders(
    <FileUpload
      name="test"
      purpose="LEAVE_ATTACHMENT"
      label="Supporting documents"
      maxFiles={props.maxFiles ?? 3}
      onChange={onChange}
    />,
  );
  // applyAccept: false so files the `accept` attribute would hide still reach the component,
  // as they do when dropped.
  return { onChange, user: userEvent.setup({ applyAccept: false }) };
}

describe('FileUpload', () => {
  it('should tell the user which formats and size are accepted', () => {
    renderUpload();

    expect(screen.getByTestId('file-upload-test')).toHaveTextContent(
      'PDF, JPG, PNG, WebP. Up to 10 MB each. Up to 3 files.',
    );
  });

  it('should refuse a file type the purpose does not allow without contacting the server', async () => {
    const { user, onChange } = renderUpload();
    const exe = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });

    await user.upload(screen.getByTestId('file-upload-test-input'), exe);

    expect(screen.getByTestId('file-upload-item-error-tool.exe')).toHaveTextContent(
      'This file type is not accepted here.',
    );
    expect(requestUpload).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('should refuse a file one byte over the limit without contacting the server', async () => {
    const { user } = renderUpload();

    await user.upload(screen.getByTestId('file-upload-test-input'), pdf('big.pdf', 10 * MB + 1));

    expect(screen.getByTestId('file-upload-item-error-big.pdf')).toHaveTextContent(
      'This file is too large.',
    );
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it('should keep only as many files as allowed and say so', async () => {
    const { user } = renderUpload({ maxFiles: 2 });
    requestUpload.mockReturnValue(new Promise(() => undefined));

    await user.upload(screen.getByTestId('file-upload-test-input'), [
      pdf('a.pdf'),
      pdf('b.pdf'),
      pdf('c.pdf'),
    ]);

    expect(screen.getByTestId('file-upload-item-a.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('file-upload-item-b.pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('file-upload-item-c.pdf')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-upload-test-too-many')).toHaveTextContent(
      'Only 2 files can be added here.',
    );
    expect(screen.getByTestId('file-upload-test-choose-btn')).toBeDisabled();
  });

  it('should show the translated server error and offer a retry when the upload limit is hit', async () => {
    const { user } = renderUpload();
    requestUpload.mockRejectedValue(
      new CombinedGraphQLErrors({
        errors: [{ message: 'raw server text', extensions: { code: 'FILE_UPLOAD_LIMIT_REACHED' } }],
      }),
    );

    await user.upload(screen.getByTestId('file-upload-test-input'), pdf('a.pdf'));

    await waitFor(() =>
      expect(screen.getByTestId('file-upload-item-error-a.pdf')).toHaveTextContent(
        'You have too many unfinished uploads. Wait a little, then try again.',
      ),
    );
    expect(screen.getByTestId('file-upload-item-error-a.pdf')).not.toHaveTextContent(
      'raw server text',
    );
    expect(screen.getByTestId('file-upload-item-retry-a.pdf')).toBeInTheDocument();
  });

  it('should remove a refused file from the list', async () => {
    const { user } = renderUpload();
    const exe = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });
    await user.upload(screen.getByTestId('file-upload-test-input'), exe);

    await user.click(screen.getByRole('button', { name: 'Remove tool.exe' }));

    expect(screen.queryByTestId('file-upload-item-tool.exe')).not.toBeInTheDocument();
  });
});
