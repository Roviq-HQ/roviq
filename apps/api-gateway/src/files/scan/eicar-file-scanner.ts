import { FileScanner, type ScanResult } from './file-scanner';

// Split so that this source file is not itself flagged by a virus scanner.
export const EICAR_TEST_STRING = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
  'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
].join('');

/**
 * Stand-in for local development and automated tests: knows the EICAR test file and nothing
 * else. It finds no real malware, so the gateway refuses to start with it in production.
 */
export class EicarFileScanner extends FileScanner {
  async scan(bytes: Buffer): Promise<ScanResult> {
    return bytes.includes(EICAR_TEST_STRING)
      ? { verdict: 'INFECTED', signature: 'Eicar-Test-Signature' }
      : { verdict: 'CLEAN' };
  }
}
