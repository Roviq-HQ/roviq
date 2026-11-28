import { describe, expect, it } from 'vitest';
import {
  natsRefused,
  postgresRefused,
  problems,
  redisRefused,
} from '../check-internal-service-auth';

describe('check-internal-service-auth', () => {
  it('should read a Redis NOAUTH answer as a refusal, and a number as an accepted command', () => {
    expect(redisRefused('NOAUTH Authentication required.\n')).toBe(true);
    expect(redisRefused('42\n')).toBe(false);
  });

  it('should read a NATS authorization violation as a refusal', () => {
    expect(natsRefused("'Authorization Violation'")).toBe(true);
    expect(natsRefused('AUTHORIZATION_VIOLATION')).toBe(true);
    expect(natsRefused('connected without a user')).toBe(false);
  });

  it('should read a PostgreSQL permission error as a refusal', () => {
    expect(postgresRefused('permission denied for table users')).toBe(true);
    expect(postgresRefused('read the users table')).toBe(false);
  });

  it('should report nothing when every service refuses', () => {
    expect(
      problems([
        { service: 'redis', answer: 'NOAUTH Authentication required.' },
        { service: 'nats', answer: 'Authorization Violation' },
        { service: 'temporal database role', answer: 'permission denied for table users' },
      ]),
    ).toEqual([]);
  });

  it('should name each service that accepted, and one that did not answer', () => {
    const found = problems([
      { service: 'redis', answer: '0' },
      { service: 'nats', answer: 'connected without a user' },
      { service: 'temporal database role', answer: '' },
    ]);
    expect(found).toHaveLength(3);
    expect(found[0]).toContain('redis');
    expect(found[2]).toContain('(nothing)');
  });

  it('should treat a service it has no rule for as a problem', () => {
    expect(problems([{ service: 'unknown', answer: 'NOAUTH' }])).toHaveLength(1);
  });
});
