import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { FilePurpose } from '@roviq/common-types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

function photo(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'image/jpeg' });
}

function renderUpload(props: { maxFiles?: number; crop?: 'square'; purpose?: FilePurpose } = {}) {
  const onChange = vi.fn<(fileIds: string[], files: File[]) => void>();
  renderWithProviders(
    <FileUpload
      name="test"
      purpose={props.purpose ?? 'LEAVE_ATTACHMENT'}
      label="Supporting documents"
      maxFiles={props.maxFiles ?? 3}
      crop={props.crop}
      onChange={onChange}
    />,
  );
  // applyAccept: false so files the `accept` attribute would hide still reach the component,
  // as they do when dropped.
  return { onChange, user: userEvent.setup({ applyAccept: false }) };
}

/** Stands in for the storage PUT: answers 200 as soon as the body is sent. */
class AcceptingXhr {
  status = 0;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {}
  send() {
    this.status = 200;
    queueMicrotask(() => this.onload?.());
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  requestUpload.mockReset();
});

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
    expect(onChange).toHaveBeenLastCalledWith([], []);
  });

  it('should refuse a file one byte over the limit without contacting the server', async () => {
    const { user } = renderUpload();

    await user.upload(screen.getByTestId('file-upload-test-input'), pdf('big.pdf', 10 * MB + 1));

    expect(screen.getByTestId('file-upload-item-error-big.pdf')).toHaveTextContent(
      'This file is too large.',
    );
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it('should let a photo larger than the limit be picked, since it is shrunk before upload', async () => {
    const { user } = renderUpload();

    await user.upload(screen.getByTestId('file-upload-test-input'), photo('big.jpg', 12 * MB));

    // This test browser cannot shrink images, so the limit applies to the photo as picked.
    await waitFor(() =>
      expect(screen.getByTestId('file-upload-item-error-big.jpg')).toHaveTextContent(
        'This file is too large.',
      ),
    );
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it('should refuse a photo over 50 MB without trying to shrink it', async () => {
    const { user } = renderUpload();

    await user.upload(screen.getByTestId('file-upload-test-input'), photo('huge.jpg', 50 * MB + 1));

    expect(screen.getByTestId('file-upload-item-error-huge.jpg')).toHaveTextContent(
      'This file is too large.',
    );
  });

  it('should open the crop step for a picked picture and upload nothing on cancel', async () => {
    const { user } = renderUpload({ crop: 'square', maxFiles: 1 });

    await user.upload(screen.getByTestId('file-upload-test-input'), photo('me.jpg', 2048));

    expect(await screen.findByTestId('file-upload-crop-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('file-upload-item-me.jpg')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('file-upload-crop-cancel-btn'));

    await waitFor(() =>
      expect(screen.queryByTestId('file-upload-crop-dialog')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('file-upload-item-me.jpg')).not.toBeInTheDocument();
    expect(requestUpload).not.toHaveBeenCalled();
  });

  it('should skip the crop step for a file that is not a picture', async () => {
    const { user } = renderUpload({ crop: 'square', maxFiles: 1 });
    const exe = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });

    await user.upload(screen.getByTestId('file-upload-test-input'), exe);

    expect(screen.queryByTestId('file-upload-crop-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('file-upload-item-error-tool.exe')).toBeInTheDocument();
  });

  it('should let a valid file take the place of a refused one in a one-file field', async () => {
    const { user } = renderUpload({ maxFiles: 1 });
    requestUpload.mockReturnValue(new Promise(() => undefined));
    const exe = new File(['MZ'], 'tool.exe', { type: 'application/x-msdownload' });
    await user.upload(screen.getByTestId('file-upload-test-input'), exe);
    expect(screen.getByTestId('file-upload-item-error-tool.exe')).toBeInTheDocument();

    await user.upload(screen.getByTestId('file-upload-test-input'), pdf('degree.pdf'));

    expect(screen.getByTestId('file-upload-item-degree.pdf')).toBeInTheDocument();
    expect(screen.queryByTestId('file-upload-item-tool.exe')).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-upload-test-too-many')).not.toBeInTheDocument();
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

  describe('CSV picked on Windows', () => {
    // With Excel installed, Windows browsers report a .csv as Excel's type.
    const windowsCsv = () =>
      new File(['first_name,date_of_birth,gender\n'], 'students.csv', {
        type: 'application/vnd.ms-excel',
      });

    it('should upload a .csv reported as application/vnd.ms-excel as text/csv', async () => {
      vi.stubGlobal('XMLHttpRequest', AcceptingXhr);
      requestUpload.mockResolvedValue({
        data: {
          requestFileUpload: {
            fileId: 'file-1',
            uploadUrl: 'https://storage.test/put',
            headers: [],
          },
        },
      });
      const { user, onChange } = renderUpload({ purpose: 'BULK_IMPORT_CSV', maxFiles: 1 });

      await user.upload(screen.getByTestId('file-upload-test-input'), windowsCsv());

      await waitFor(() => expect(onChange.mock.lastCall?.[0]).toEqual(['file-1']));
      expect(requestUpload).toHaveBeenCalledWith({
        variables: {
          input: {
            purpose: 'BULK_IMPORT_CSV',
            subjectUserId: undefined,
            fileName: 'students.csv',
            contentType: 'text/csv',
            sizeBytes: 32,
          },
        },
      });
      const [file] = onChange.mock.lastCall?.[1] ?? [];
      expect(file).toBeInstanceOf(File);
      expect(file?.name).toBe('students.csv');
      expect(file?.type).toBe('text/csv');
      expect(screen.queryByTestId('file-upload-item-error-students.csv')).not.toBeInTheDocument();
    });

    it('should still refuse an Excel workbook with the same reported type', async () => {
      const { user } = renderUpload({ purpose: 'BULK_IMPORT_CSV', maxFiles: 1 });
      const workbook = new File(['PK'], 'students.xls', { type: 'application/vnd.ms-excel' });

      await user.upload(screen.getByTestId('file-upload-test-input'), workbook);

      expect(screen.getByTestId('file-upload-item-error-students.xls')).toHaveTextContent(
        'This file type is not accepted here.',
      );
      expect(requestUpload).not.toHaveBeenCalled();
    });

    it('should let the file picker show .csv files by extension', () => {
      renderUpload({ purpose: 'BULK_IMPORT_CSV', maxFiles: 1 });

      expect(screen.getByTestId('file-upload-test-input')).toHaveAttribute(
        'accept',
        'text/csv,.csv',
      );
    });
  });
});
