import { describe, expect, it } from 'vitest';
import { clientAddressKey } from '../client-address-key';

describe('clientAddressKey', () => {
  it('should keep an IPv4 address as it is', () => {
    expect(clientAddressKey('203.0.113.7')).toBe('203.0.113.7');
  });

  it('should count an IPv4 address written as IPv6 under the IPv4 address', () => {
    expect(clientAddressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddressKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('should count every address of one IPv6 /64 under the same key', () => {
    const first = clientAddressKey('2001:db8:12:34:aaaa:bbbb:cccc:1');
    expect(first).toBe('2001:db8:12:34::/64');
    expect(clientAddressKey('2001:0DB8:0012:0034::2')).toBe(first);
    expect(clientAddressKey('2001:db8:12:34:ffff:ffff:ffff:ffff')).toBe(first);
  });

  it('should count another /64 under another key', () => {
    expect(clientAddressKey('2001:db8:12:35::1')).not.toBe(clientAddressKey('2001:db8:12:34::1'));
  });

  it('should fill in a shortened address and drop a zone', () => {
    expect(clientAddressKey('::1')).toBe('0:0:0:0::/64');
    expect(clientAddressKey('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('should leave text that is not an address alone', () => {
    expect(clientAddressKey('unknown')).toBe('unknown');
  });
});
