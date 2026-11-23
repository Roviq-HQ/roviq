import { describe, expect, it } from 'vitest';
import { findDbImports } from '../check-service-db-access';

describe('check-service-db-access', () => {
  it('should flag value imports from @roviq/database and drizzle-orm', () => {
    const source = `
import { DRIZZLE_DB, type DrizzleDB, studentsLive, withTenant } from '@roviq/database';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
`;

    expect(findDbImports(source)).toEqual([
      { module: '@roviq/database', names: ['DRIZZLE_DB', 'studentsLive', 'withTenant'] },
      { module: 'drizzle-orm', names: ['and', 'eq'] },
      { module: 'drizzle-orm/pg-core', names: ['alias'] },
    ]);
  });

  it('should accept type imports and the allowed constants', () => {
    const source = `
import type { DrizzleDB, SectionStrengthNorms } from '@roviq/database';
import { SYSTEM_USER_ID, type InstituteContext } from '@roviq/database';
import { BusinessException } from '@roviq/common-types';
`;

    expect(findDbImports(source)).toEqual([]);
  });

  it('should flag an aliased or multi-line import', () => {
    const source = `
import {
  withAdmin as asAdmin,
  type PlatformContext,
} from '@roviq/database';
`;

    expect(findDbImports(source)).toEqual([{ module: '@roviq/database', names: ['withAdmin'] }]);
  });
});
