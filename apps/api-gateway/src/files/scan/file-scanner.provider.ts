import { Logger, type Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClamavFileScanner } from './clamav-file-scanner';
import { DisabledFileScanner } from './disabled-file-scanner';
import { EicarFileScanner } from './eicar-file-scanner';
import { FileScanner } from './file-scanner';

export const FILE_SCANNER_VALUES = [
  // Real scanning through a clamd daemon (CLAMAV_HOST, CLAMAV_PORT)
  'clamav',
  // Detects only the EICAR test file; for local development and automated tests
  'eicar',
  // No scanning: uploaded documents are stored and served unscanned
  'off',
] as const;

const logger = new Logger('FileScanner');

/**
 * Unset means off in the production image and eicar everywhere else. Production runs without
 * ClamAV for now (owner's decision, 2026-11-21); set FILE_SCANNER=clamav to turn it on.
 */
export function createFileScanner(config: ConfigService): FileScanner {
  const production = config.get<string>('NODE_ENV') === 'production';
  const kind = config.get<string>('FILE_SCANNER') ?? (production ? 'off' : 'eicar');
  if (kind === 'clamav') return new ClamavFileScanner(config);
  if (kind === 'off') {
    logger.warn('Malware scanning of uploads is OFF (FILE_SCANNER=off or unset in production)');
    return new DisabledFileScanner();
  }
  if (kind === 'eicar') {
    if (production) {
      throw new Error('FILE_SCANNER=eicar finds no real malware; use clamav or off in production');
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
