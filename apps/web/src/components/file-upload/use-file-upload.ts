'use client';

import {
  FILE_CONTENT_TYPE,
  FILE_PURPOSE_POLICY,
  type FilePurpose,
  IMAGE_PICK_MAX_BYTES,
  isImageContentType,
} from '@roviq/common-types';
import { extractGraphQLErrorCode, gql, useMutation } from '@roviq/graphql';
import type { FileUploadTicket, RequestFileUploadInput } from '@roviq/graphql/generated';
import * as React from 'react';
import { prepareImage } from './prepare-image';

const REQUEST_FILE_UPLOAD = gql`
  mutation RequestFileUpload($input: RequestFileUploadInput!) {
    requestFileUpload(input: $input) {
      fileId
      uploadUrl
      headers {
        name
        value
      }
    }
  }
`;

// A reseller's own files (its branding) are requested through the reseller portal's mutation.
const RESELLER_REQUEST_FILE_UPLOAD = gql`
  mutation ResellerRequestFileUpload($input: RequestFileUploadInput!) {
    resellerRequestFileUpload(input: $input) {
      fileId
      uploadUrl
      headers {
        name
        value
      }
    }
  }
`;

type Ticket = Pick<FileUploadTicket, 'fileId' | 'uploadUrl' | 'headers'>;

/** Keys under `fileUpload.errors` in the message files. */
export const FILE_UPLOAD_ERROR_KEYS = [
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_TOO_LARGE',
  'FILE_UPLOAD_LIMIT_REACHED',
  'FILE_CONTENT_MISMATCH',
  'FILE_IMAGE_INVALID',
  'FILE_INFECTED',
  'FILE_SCAN_UNAVAILABLE',
  'FILE_NOT_FOUND',
  'FORBIDDEN',
  'TOO_MANY_FILES',
  'UPLOAD_FAILED',
] as const;
export type FileUploadErrorKey = (typeof FILE_UPLOAD_ERROR_KEYS)[number];

/** Maps a GraphQL error code to a `fileUpload.errors` key, or null when it is not a file error. */
export function fileUploadErrorKey(code: string | null): FileUploadErrorKey | null {
  return FILE_UPLOAD_ERROR_KEYS.find((key) => key === code) ?? null;
}

export interface UploadItem {
  /** Stable key for rendering; not the server id. */
  key: string;
  name: string;
  sizeBytes: number;
  status: 'uploading' | 'done' | 'error';
  /** 0 to 100 while uploading. */
  progress: number;
  /** Set once the upload has finished. */
  fileId: string | null;
  errorKey: FileUploadErrorKey | null;
  /** The picked file, after `withAllowedCsvType`. */
  file: File;
}

interface Tracked {
  file: File;
  abort: AbortController;
}

function putWithProgress(
  ticket: Ticket,
  file: File,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // XHR, not fetch: fetch cannot report upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.uploadUrl);
    for (const header of ticket.headers) xhr.setRequestHeader(header.name, header.value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error()));
    xhr.onerror = () => reject(new Error());
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * Windows reports a .csv as `application/vnd.ms-excel` (or nothing) when Excel is installed, so the
 * name decides for a purpose that takes CSV.
 */
export function withAllowedCsvType(file: File, allowed: readonly string[]): File {
  const isCsvName = file.name.toLowerCase().endsWith('.csv');
  if (
    !isCsvName ||
    file.type === FILE_CONTENT_TYPE.CSV ||
    !allowed.includes(FILE_CONTENT_TYPE.CSV)
  ) {
    return file;
  }
  return new File([file], file.name, {
    type: FILE_CONTENT_TYPE.CSV,
    lastModified: file.lastModified,
  });
}

export function useFileUpload(purpose: FilePurpose, subjectUserId?: string) {
  const policy = FILE_PURPOSE_POLICY[purpose];
  const [items, setItems] = React.useState<UploadItem[]>([]);
  const tracked = React.useRef(new Map<string, Tracked>());
  const [requestInstituteUpload] = useMutation<
    { requestFileUpload: Ticket },
    { input: RequestFileUploadInput }
  >(REQUEST_FILE_UPLOAD);
  const [requestResellerUpload] = useMutation<
    { resellerRequestFileUpload: Ticket },
    { input: RequestFileUploadInput }
  >(RESELLER_REQUEST_FILE_UPLOAD);
  const ownedByReseller = policy.owner === 'RESELLER';
  const requestTicket = React.useCallback(
    async (input: RequestFileUploadInput): Promise<Ticket | undefined> => {
      if (ownedByReseller) {
        const { data } = await requestResellerUpload({ variables: { input } });
        return data?.resellerRequestFileUpload;
      }
      const { data } = await requestInstituteUpload({ variables: { input } });
      return data?.requestFileUpload;
    },
    [ownedByReseller, requestInstituteUpload, requestResellerUpload],
  );

  const patch = React.useCallback((key: string, change: Partial<UploadItem>) => {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }, []);

  const start = React.useCallback(
    async (key: string, file: File) => {
      const abort = new AbortController();
      tracked.current.set(key, { file, abort });
      patch(key, { status: 'uploading', progress: 0, errorKey: null, fileId: null });
      try {
        // Phone photos are far larger than anything shown; shrink them before they leave the device.
        const upload = isImageContentType(file.type) ? await prepareImage(file) : file;
        if (abort.signal.aborted) return;
        if (upload.size > policy.maxSizeBytes) {
          patch(key, { status: 'error', errorKey: 'FILE_TOO_LARGE' });
          return;
        }
        const ticket = await requestTicket({
          purpose,
          subjectUserId,
          fileName: upload.name,
          contentType: upload.type,
          sizeBytes: upload.size,
        });
        if (!ticket) throw new Error();
        await putWithProgress(ticket, upload, abort.signal, (progress) => patch(key, { progress }));
        patch(key, { status: 'done', progress: 100, fileId: ticket.fileId });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        patch(key, {
          status: 'error',
          errorKey: fileUploadErrorKey(extractGraphQLErrorCode(error)) ?? 'UPLOAD_FAILED',
        });
      }
    },
    [patch, policy, purpose, requestTicket, subjectUserId],
  );

  const add = React.useCallback(
    (files: File[]) => {
      const allowed: readonly string[] = policy.allowedContentTypes;
      const added = files.map((picked) => {
        const file = withAllowedCsvType(picked, allowed);
        const errorKey: FileUploadErrorKey | null = !allowed.includes(file.type)
          ? 'FILE_TYPE_NOT_ALLOWED'
          : // A photo is shrunk before upload, so its limit applies to the result (see `start`).
            file.size > (isImageContentType(file.type) ? IMAGE_PICK_MAX_BYTES : policy.maxSizeBytes)
            ? 'FILE_TOO_LARGE'
            : null;
        const item: UploadItem = {
          key: crypto.randomUUID(),
          name: file.name,
          sizeBytes: file.size,
          status: errorKey ? 'error' : 'uploading',
          progress: 0,
          fileId: null,
          errorKey,
          file,
        };
        return { item, file };
      });
      setItems((current) => [...current, ...added.map(({ item }) => item)]);
      for (const { item, file } of added) {
        if (!item.errorKey) void start(item.key, file);
      }
    },
    [policy, start],
  );

  const remove = React.useCallback((key: string) => {
    tracked.current.get(key)?.abort.abort();
    tracked.current.delete(key);
    setItems((current) => current.filter((item) => item.key !== key));
  }, []);

  const retry = React.useCallback(
    (key: string) => {
      const entry = tracked.current.get(key);
      if (entry) void start(key, entry.file);
    },
    [start],
  );

  React.useEffect(() => {
    const uploads = tracked.current;
    return () => {
      for (const { abort } of uploads.values()) abort.abort();
    };
  }, []);

  return { items, add, remove, retry, policy };
}
