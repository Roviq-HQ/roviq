import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isSignedByProvider } from '../webhook-signature';

const SECRET = 'fake-app-secret';
const BODY = Buffer.from('{"object":"whatsapp_business_account","entry":[]}', 'utf8');

const sign = (body: Buffer, secret: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('isSignedByProvider', () => {
  it('should accept the HMAC-SHA256 of the raw bytes keyed with the app secret', () => {
    expect(isSignedByProvider(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it('should accept the digest in upper-case hex', () => {
    const header = `sha256=${createHmac('sha256', SECRET).update(BODY).digest('hex').toUpperCase()}`;

    expect(isSignedByProvider(BODY, header, SECRET)).toBe(true);
  });

  it('should refuse a signature made with another secret', () => {
    expect(isSignedByProvider(BODY, sign(BODY, 'another-fake-secret'), SECRET)).toBe(false);
  });

  it('should refuse a body changed by one byte', () => {
    const changed = Buffer.from(BODY);
    changed[changed.length - 2] = 0x7b;

    expect(isSignedByProvider(changed, sign(BODY, SECRET), SECRET)).toBe(false);
  });

  it.each([
    ['a missing header', undefined],
    ['an empty header', ''],
    [
      'a digest without the sha256= prefix',
      createHmac('sha256', SECRET).update(BODY).digest('hex'),
    ],
    ['another algorithm prefix', `sha1=${createHmac('sha1', SECRET).update(BODY).digest('hex')}`],
    ['a non-hex digest', `sha256=${'z'.repeat(64)}`],
    ['a short digest', sign(BODY, SECRET).slice(0, -2)],
    ['a long digest', `${sign(BODY, SECRET)}00`],
    ['only the prefix', 'sha256='],
  ])('should refuse %s without throwing', (_case, header) => {
    expect(() => isSignedByProvider(BODY, header, SECRET)).not.toThrow();
    expect(isSignedByProvider(BODY, header, SECRET)).toBe(false);
  });
});
