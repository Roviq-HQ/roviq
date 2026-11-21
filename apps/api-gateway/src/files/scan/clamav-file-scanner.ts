import { connect } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileScanner, ScannerUnavailableError, type ScanResult } from './file-scanner';

export const CLAMAV_DEFAULT_PORT = 3310;
export const CLAMAV_TIMEOUT_MS = 30_000;
const CHUNK_BYTES = 64 * 1024;

/** Sends the bytes to `clamd` with its INSTREAM command and reads the one-line verdict. */
@Injectable()
export class ClamavFileScanner extends FileScanner {
  private readonly host: string;
  private readonly port: number;

  constructor(config: ConfigService) {
    super();
    this.host = config.getOrThrow<string>('CLAMAV_HOST');
    this.port = Number(config.get<string>('CLAMAV_PORT') ?? CLAMAV_DEFAULT_PORT);
  }

  scan(bytes: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const reply: Buffer[] = [];
      socket.setTimeout(CLAMAV_TIMEOUT_MS);
      socket.on('timeout', () => socket.destroy(new Error('timed out')));
      socket.on('error', (err) => reject(new ScannerUnavailableError(err.message)));
      socket.on('data', (chunk: Buffer) => reply.push(chunk));
      socket.on('end', () => {
        try {
          resolve(parseClamdReply(Buffer.concat(reply).toString('utf8')));
        } catch (err) {
          reject(err);
        }
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
          const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        // A zero-length chunk ends the stream.
        socket.write(Buffer.alloc(4));
      });
    });
  }
}

/** `stream: OK`, `stream: <signature> FOUND`, or an error such as a size limit. */
export function parseClamdReply(raw: string): ScanResult {
  const reply = raw.replace(/\0/g, '').trim();
  if (reply === 'stream: OK') return { verdict: 'CLEAN' };
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found?.[1]) return { verdict: 'INFECTED', signature: found[1] };
  // Anything else is not a verdict; treating it as clean would let a file through unscanned.
  throw new ScannerUnavailableError(reply || 'empty reply');
}
