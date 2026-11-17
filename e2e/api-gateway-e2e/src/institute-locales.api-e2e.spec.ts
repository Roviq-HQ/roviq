import assert from 'node:assert';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED } from '../../shared/seed-fixtures';
import {
  loginAsInstituteAdmin,
  loginAsInstituteAdminSecondInstitute,
  loginAsPlatformAdmin,
  loginAsTeacher,
} from './helpers/auth';
import { gql } from './helpers/gql-client';

interface Settings {
  id: string;
  supportedLocales: string[];
  defaultLocale: string;
  version: number;
}
const READ = `query { myInstitute { id supportedLocales defaultLocale version } }`;
const UPDATE = `mutation Locales($input: UpdateInstituteLocalesInput!) { updateInstituteLocales(input: $input) { id supportedLocales defaultLocale version } }`;

describe('Institute content languages', () => {
  let token: string;
  let otherToken: string;
  let teacherToken: string;
  let platformToken: string;
  let original: Settings;
  let other: Settings;

  async function read(accessToken: string) {
    const result = await gql<{ myInstitute: Settings }>(READ, {}, accessToken);
    expect(result.errors).toBeUndefined();
    assert(result.data);
    return result.data.myInstitute;
  }
  beforeAll(async () => {
    token = (await loginAsInstituteAdmin()).accessToken;
    otherToken = (await loginAsInstituteAdminSecondInstitute()).accessToken;
    teacherToken = (await loginAsTeacher()).accessToken;
    platformToken = (await loginAsPlatformAdmin()).accessToken;
    original = await read(token);
    other = await read(otherToken);
  });
  afterAll(async () => {
    if (!original) return;
    const current = await read(token);
    const restored = await gql(
      UPDATE,
      {
        input: {
          supportedLocales: original.supportedLocales,
          defaultLocale: original.defaultLocale,
          version: current.version,
        },
      },
      token,
    );
    expect(restored.errors).toBeUndefined();
  });
  it('persists a regional default without changing another institute or the UI language list', async () => {
    const current = await read(token);
    const response = await gql<{ updateInstituteLocales: Settings }>(
      UPDATE,
      { input: { supportedLocales: ['en', 'ta'], defaultLocale: 'ta', version: current.version } },
      token,
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.updateInstituteLocales).toEqual({
      id: original.id,
      supportedLocales: ['en', 'ta'],
      defaultLocale: 'ta',
      version: current.version + 1,
    });
    expect(await read(token)).toEqual(response.data?.updateInstituteLocales);
    expect(await read(otherToken)).toEqual(other);
  });
  it.each([
    { supportedLocales: ['ta'], defaultLocale: 'ta' },
    { supportedLocales: ['en'], defaultLocale: 'ta' },
    { supportedLocales: ['en', 'zz'], defaultLocale: 'en' },
    { supportedLocales: ['en', 'en'], defaultLocale: 'en' },
    { supportedLocales: [], defaultLocale: 'en' },
  ])('rejects invalid settings %j and preserves saved values', async (settings) => {
    const current = await read(token);
    const response = await gql(UPDATE, { input: { ...settings, version: current.version } }, token);
    expect(response.errors).toHaveLength(1);
    expect(await read(token)).toEqual(current);
  });
  it('finds institutes by a non-English translation through the existing platform search API', async () => {
    const response = await gql<{ adminListInstitutes: { edges: { node: { id: string } }[] } }>(
      `query SearchInstitutes($filter: AdminListInstitutesFilterInput!) { adminListInstitutes(filter: $filter) { edges { node { id } } } }`,
      { filter: { search: SEED.INSTITUTE_1.nameHi, first: 20 } },
      platformToken,
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.adminListInstitutes.edges.map((edge) => edge.node.id)).toContain(
      SEED.INSTITUTE_1.id,
    );
  });
  it('rejects stale versions', async () => {
    const current = await read(token);
    const response = await gql(
      UPDATE,
      { input: { supportedLocales: ['en'], defaultLocale: 'en', version: current.version - 1 } },
      token,
    );
    expect(response.errors).toHaveLength(1);
    expect(await read(token)).toEqual(current);
  });
  it('rejects anonymous, teacher and platform-scope writes', async () => {
    for (const accessToken of [undefined, teacherToken, platformToken]) {
      const response = await gql(
        UPDATE,
        { input: { supportedLocales: ['en'], defaultLocale: 'en', version: original.version } },
        accessToken,
      );
      expect(response.errors?.map((error) => error.extensions?.code)).toEqual([
        accessToken ? 'FORBIDDEN' : 'UNAUTHENTICATED',
      ]);
    }
  });
});
