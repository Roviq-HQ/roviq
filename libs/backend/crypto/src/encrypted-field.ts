import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/** Reads a 64-character hex key (32 bytes) from the environment; refuses any other shape. */
function readKey(config: ConfigService, name: string): Buffer {
  return parseKey(config.getOrThrow<string>(name), name);
}

function parseKey(hexKey: string, name: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error(
      `${name} must be a 64-character hex string (32 bytes). ` +
        "Generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hexKey, 'hex');
}

/** AES-256-GCM; the result is `IV (12B) + authTag (16B) + ciphertext`. */
function seal(key: Buffer, plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function open(key: Buffer, packed: Buffer): string {
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/** Encrypts identity fields (Aadhaar, PAN) with the key in `IDENTITY_ENCRYPTION_KEY`. */
@Injectable()
export class IdentityCryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = readKey(config, 'IDENTITY_ENCRYPTION_KEY');
  }

  encrypt(plaintext: string): Buffer {
    return seal(this.key, plaintext);
  }

  decrypt(packed: Buffer): string {
    return open(this.key, packed);
  }
}

/**
 * Encrypts the provider access token of a messaging sender. A key of its own
 * (`MESSAGING_ENCRYPTION_KEY`): leaking one key does not open the other's data. Takes the key
 * itself, so each app builds it from its own configuration.
 */
export class MessagingTokenCipher {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    this.key = parseKey(hexKey, 'MESSAGING_ENCRYPTION_KEY');
  }

  encrypt(token: string): Buffer {
    return seal(this.key, token);
  }

  decrypt(packed: Buffer): string {
    return open(this.key, packed);
  }
}
