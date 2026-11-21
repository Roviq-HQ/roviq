import { type AddressInfo, createServer, type Server } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import { ClamavFileScanner, parseClamdReply } from '../clamav-file-scanner';
import { EICAR_TEST_STRING, EicarFileScanner } from '../eicar-file-scanner';
import { ScannerUnavailableError } from '../file-scanner';
import { createFileScanner } from '../file-scanner.provider';

/** Speaks clamd's INSTREAM protocol: collects the chunks, answers once the zero chunk arrives. */
function fakeClamd(reply: (stream: Buffer) => string | null): Promise<Server> {
  const server = createServer((socket) => {
    let received = Buffer.alloc(0);
    socket.on('data', (data: Buffer) => {
      received = Buffer.concat([received, data]);
      const command = 'zINSTREAM\0';
      if (received.length < command.length) return;
      let offset = command.length;
      const chunks: Buffer[] = [];
      while (offset + 4 <= received.length) {
        const length = received.readUInt32BE(offset);
        if (length === 0) {
          const answer = reply(Buffer.concat(chunks));
          if (answer === null) return;
          socket.end(`${answer}\0`);
          return;
        }
        if (offset + 4 + length > received.length) return;
        chunks.push(received.subarray(offset + 4, offset + 4 + length));
        offset += 4 + length;
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function scannerFor(server: Server): ClamavFileScanner {
  const { port } = server.address() as AddressInfo;
  return new ClamavFileScanner(
    new ConfigService({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(port) }),
  );
}

describe('ClamavFileScanner', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('should send every byte in length-prefixed chunks and report a clean file', async () => {
    const bytes = Buffer.alloc(200_000, 7);
    let seen = Buffer.alloc(0);
    server = await fakeClamd((stream) => {
      seen = stream;
      return 'stream: OK';
    });

    await expect(scannerFor(server).scan(bytes)).resolves.toEqual({ verdict: 'CLEAN' });
    expect(seen.equals(bytes)).toBe(true);
  });

  it('should report the signature of an infected file', async () => {
    server = await fakeClamd(() => 'stream: Win.Test.EICAR_HDB-1 FOUND');

    await expect(scannerFor(server).scan(Buffer.from('x'))).resolves.toEqual({
      verdict: 'INFECTED',
      signature: 'Win.Test.EICAR_HDB-1',
    });
  });

  it('should not treat a size-limit error as clean', async () => {
    server = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR');

    await expect(scannerFor(server).scan(Buffer.from('x'))).rejects.toBeInstanceOf(
      ScannerUnavailableError,
    );
  });

  it('should fail when clamd closes the connection without an answer', async () => {
    server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));

    await expect(scannerFor(server).scan(Buffer.from('x'))).rejects.toBeInstanceOf(
      ScannerUnavailableError,
    );
  });

  it('should fail when nothing listens on the port', async () => {
    const closed = await fakeClamd(() => 'stream: OK');
    const scanner = scannerFor(closed);
    await new Promise<void>((resolve) => closed.close(() => resolve()));

    await expect(scanner.scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScannerUnavailableError);
  });
});

describe('parseClamdReply', () => {
  it('should refuse an empty reply', () => {
    expect(() => parseClamdReply('')).toThrow(ScannerUnavailableError);
  });
});

describe('EicarFileScanner', () => {
  it('should find the EICAR test string anywhere in the bytes', async () => {
    const scanner = new EicarFileScanner();

    await expect(scanner.scan(Buffer.from(`%PDF-1.7\n${EICAR_TEST_STRING}`))).resolves.toEqual({
      verdict: 'INFECTED',
      signature: 'Eicar-Test-Signature',
    });
    await expect(scanner.scan(Buffer.from('%PDF-1.7\nhello'))).resolves.toEqual({
      verdict: 'CLEAN',
    });
  });
});

describe('createFileScanner', () => {
  it('should use the EICAR stand-in outside production when nothing is configured', () => {
    expect(createFileScanner(new ConfigService({ NODE_ENV: 'test' }))).toBeInstanceOf(
      EicarFileScanner,
    );
  });

  it('should use ClamAV in production when nothing is configured', () => {
    const config = new ConfigService({ NODE_ENV: 'production', CLAMAV_HOST: 'clamav' });

    expect(createFileScanner(config)).toBeInstanceOf(ClamavFileScanner);
  });

  it('should refuse to start in production without a ClamAV host', () => {
    expect(() => createFileScanner(new ConfigService({ NODE_ENV: 'production' }))).toThrow(
      /CLAMAV_HOST/,
    );
  });

  it('should refuse the EICAR stand-in in production', () => {
    const config = new ConfigService({ NODE_ENV: 'production', FILE_SCANNER: 'eicar' });

    expect(() => createFileScanner(config)).toThrow(/production needs clamav/);
  });
});
