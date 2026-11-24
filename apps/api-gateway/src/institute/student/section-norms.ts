import type { SectionStrengthNorms } from './repositories/types';

/** Used when the institute's configuration has no section strength norms. */
export const DEFAULT_SECTION_NORMS: SectionStrengthNorms = {
  optimal: 40,
  hardMax: 45,
  exemptionAllowed: true,
};
