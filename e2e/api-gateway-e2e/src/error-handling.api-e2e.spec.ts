/**
 * Structured GraphQL errors (ROV-83): every failure carries
 * `extensions.{ code, statusCode }` and nothing else — the e2e gateway runs
 * outside development, so a stacktrace or `originalError` here is a leak.
 */
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { E2E_USERS } from '../../shared/seed-fixtures';
import { loginAsTeacher } from './helpers/auth';
import { gql } from './helpers/gql-client';

const LOGIN = `mutation Login($username: String!, $password: String!) {
  instituteLogin(username: $username, password: $password) { accessToken }
}`;
const VERIFY_PASSKEY_AUTH = `mutation VerifyPasskeyAuth($input: VerifyPasskeyAuthInput!) {
  verifyPasskeyAuth(input: $input) { accessToken }
}`;
const REMOVE_PASSKEY = `mutation RemovePasskey($passkeyId: String!) {
  removePasskey(passkeyId: $passkeyId)
}`;

describe('Structured GraphQL errors E2E', () => {
  let teacherToken: string;

  beforeAll(async () => {
    ({ accessToken: teacherToken } = await loginAsTeacher());
  });

  it('should code a wrong password as INVALID_CREDENTIALS', async () => {
    const res = await gql(LOGIN, {
      username: E2E_USERS.INSTITUTE_ADMIN.username,
      password: 'definitely-wrong',
    });

    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]?.message).toBe('Invalid credentials');
    expect(res.errors?.[0]?.extensions).toEqual({ code: 'INVALID_CREDENTIALS', statusCode: 401 });
  });

  it('should code a missing access token as UNAUTHENTICATED', async () => {
    const res = await gql('{ myPasskeys { id } }');

    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]?.extensions).toEqual({ code: 'UNAUTHENTICATED', statusCode: 401 });
  });

  it('should code a rejected refresh token as SESSION_EXPIRED', async () => {
    const res = await gql(
      'mutation Refresh($token: String!) { refreshToken(token: $token) { accessToken } }',
      { token: 'not-a-refresh-token' },
    );

    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]?.extensions).toEqual({ code: 'SESSION_EXPIRED', statusCode: 401 });
  });

  it('should code DTO validation failures as VALIDATION_FAILED with the validator message', async () => {
    const res = await gql(VERIFY_PASSKEY_AUTH, { input: { challengeId: '', credential: {} } });

    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]?.message).toBe('challengeId should not be empty');
    expect(res.errors?.[0]?.extensions).toEqual({ code: 'VALIDATION_FAILED', statusCode: 400 });
  });

  it('should code an unknown passkey challenge as PASSKEY_CHALLENGE_EXPIRED', async () => {
    const res = await gql(VERIFY_PASSKEY_AUTH, {
      input: { challengeId: randomUUID(), credential: { id: 'unknown-credential' } },
    });

    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]?.extensions).toEqual({
      code: 'PASSKEY_CHALLENGE_EXPIRED',
      statusCode: 400,
    });
  });

  it('should code removing a passkey the user does not own as PASSKEY_NOT_FOUND', async () => {
    const res = await gql(REMOVE_PASSKEY, { passkeyId: randomUUID() }, teacherToken);

    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]?.message).toBe('Passkey not found');
    expect(res.errors?.[0]?.extensions).toEqual({ code: 'PASSKEY_NOT_FOUND', statusCode: 404 });
  });

  it('should keep Apollo request-validation codes and still expose no stacktrace', async () => {
    const res = await gql('{ fieldThatDoesNotExist }');

    expect(res.errors).toHaveLength(1);
    expect(res.errors?.[0]?.extensions).toEqual({ code: 'GRAPHQL_VALIDATION_FAILED' });
  });
});
