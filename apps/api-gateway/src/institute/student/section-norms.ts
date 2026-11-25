import { EVENT_PATTERNS } from '@roviq/nats-jetstream';
import type { SectionStrengthChange, SectionStrengthNorms } from './repositories/types';

/** Used when the institute's configuration has no section strength norms. */
export const DEFAULT_SECTION_NORMS: SectionStrengthNorms = {
  optimal: 40,
  hardMax: 45,
  exemptionAllowed: true,
};

export interface SectionCapacityWarning {
  tenantId: string;
  sectionId: string;
  currentStrength: number;
  optimal: number;
}

/**
 * Once per crossing: only the placement that takes the section from below its optimal strength
 * to it or past it, so the class teacher is told again only after the section has dropped below
 * and refilled. The counts come from the placement's own transaction, under the section lock.
 */
export function sectionCapacityWarning(
  tenantId: string,
  change: SectionStrengthChange | null,
): SectionCapacityWarning | null {
  if (!change) return null;
  const { optimal } = change.norms ?? DEFAULT_SECTION_NORMS;
  if (change.before >= optimal || change.after < optimal) return null;
  return { tenantId, sectionId: change.sectionId, currentStrength: change.after, optimal };
}

type WarningPattern =
  | typeof EVENT_PATTERNS.SECTION.capacity_warning
  | typeof EVENT_PATTERNS.NOTIFICATION.SECTION_CAPACITY_WARNING;

/** Sends the warning on both subjects when the placement crossed the optimal strength. */
export function emitSectionCapacityWarning(
  emit: (pattern: WarningPattern, payload: SectionCapacityWarning) => void,
  tenantId: string,
  change: SectionStrengthChange | null,
): void {
  const warning = sectionCapacityWarning(tenantId, change);
  if (!warning) return;
  emit(EVENT_PATTERNS.SECTION.capacity_warning, warning);
  emit(EVENT_PATTERNS.NOTIFICATION.SECTION_CAPACITY_WARNING, warning);
}
