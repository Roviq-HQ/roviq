export type ScanResult = { verdict: 'CLEAN' } | { verdict: 'INFECTED'; signature: string };

/** The scanner gave no verdict (down, timed out, refused the stream). The file is not accepted. */
export class ScannerUnavailableError extends Error {
  constructor(reason: string) {
    super(`Malware scanner unavailable: ${reason}`);
    this.name = 'ScannerUnavailableError';
  }
}

/** Checks the bytes of an uploaded file for malware before the file can be attached. */
export abstract class FileScanner {
  /** Throws `ScannerUnavailableError` when no verdict could be had. */
  abstract scan(bytes: Buffer): Promise<ScanResult>;
}
