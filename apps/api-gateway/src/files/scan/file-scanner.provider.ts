import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClamavFileScanner } from './clamav-file-scanner';
import { EicarFileScanner } from './eicar-file-scanner';
import { FileScanner } from './file-scanner';

export const FILE_SCANNER_VALUES = [
  // Real scanning through a clamd daemon (CLAMAV_HOST, CLAMAV_PORT); required in production
  'clamav',
  // Detects only the EICAR test file; for local development and automated tests
  'eicar',
] as const;

/** Unset means clamav in the production image and eicar everywhere else. */
export function createFileScanner(config: ConfigService): FileScanner {
  const production = config.get<string>('NODE_ENV') === 'production';
  const kind = config.get<string>('FILE_SCANNER') ?? (production ? 'clamav' : 'eicar');
  if (kind === 'clamav') return new ClamavFileScanner(config);
  if (kind === 'eicar') {
    if (production) {
      throw new Error('FILE_SCANNER=eicar finds no real malware; production needs clamav');
    }
    return new EicarFileScanner();
  }
  throw new Error(`FILE_SCANNER must be one of: ${FILE_SCANNER_VALUES.join(', ')}`);
}

export const fileScannerProvider: Provider = {
  provide: FileScanner,
  inject: [ConfigService],
  useFactory: createFileScanner,
};
