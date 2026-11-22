import { FileScanner, type ScanResult } from './file-scanner';

/** Scanning switched off: every file is accepted unscanned. See FILE_SCANNER in docs/deployment.md. */
export class DisabledFileScanner extends FileScanner {
  async scan(): Promise<ScanResult> {
    return { verdict: 'CLEAN' };
  }
}
