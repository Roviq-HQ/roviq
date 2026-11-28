/**
 * The NATS client does not read a user and password from a server URL, so
 * `nats://user:pass@host:4222` is split here: one variable (`NATS_URL`) carries the address
 * and the service's own credentials.
 */
export interface NatsServerOptions {
  servers: string | string[];
  user?: string;
  pass?: string;
}

function split(url: string): { server: string; user?: string; pass?: string } {
  const match = /^([a-z]+:\/\/)?([^/@]*)@(.*)$/i.exec(url);
  if (!match) return { server: url };
  const [, scheme = '', userinfo = '', rest = ''] = match;
  const colon = userinfo.indexOf(':');
  const user = decodeURIComponent(colon === -1 ? userinfo : userinfo.slice(0, colon));
  const pass = colon === -1 ? undefined : decodeURIComponent(userinfo.slice(colon + 1));
  return { server: `${scheme}${rest}`, user, pass };
}

/** Connection options for one or more server URLs; credentials come from the first that has them. */
export function natsServerOptions(servers: string | readonly string[]): NatsServerOptions {
  const parts = (typeof servers === 'string' ? [servers] : [...servers]).map(split);
  const withCredentials = parts.find((part) => part.user !== undefined);
  const stripped = parts.map((part) => part.server);
  return {
    servers: typeof servers === 'string' ? (stripped[0] ?? servers) : stripped,
    ...(withCredentials?.user !== undefined && { user: withCredentials.user }),
    ...(withCredentials?.pass !== undefined && { pass: withCredentials.pass }),
  };
}
