import { isIPv4, isIPv6 } from 'node:net';

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** The eight groups of an IPv6 address, `::` filled in; null when the text is not one. */
function groupsOf(address: string): string[] | null {
  const [head, tail, ...rest] = address.split('::');
  if (rest.length > 0) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  return groups.length === 8 ? groups.map((group) => group.toLowerCase()) : null;
}

/**
 * What a request limit counts a client address under.
 *
 * - An IPv4 address written as IPv6 (`::ffff:203.0.113.7`) is its IPv4 address, so one client
 *   does not get two counters.
 * - An IPv6 client is counted by its /64 network: one subscriber is handed a whole /64 and can
 *   use a new address from it for every request.
 */
export function clientAddressKey(address: string): string {
  const zoneless = address.split('%')[0] ?? address;
  const mapped = MAPPED_IPV4.exec(zoneless);
  if (mapped?.[1]) return mapped[1];
  if (isIPv4(zoneless) || !isIPv6(zoneless)) return zoneless;
  const groups = groupsOf(zoneless);
  if (!groups) return zoneless;
  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}
