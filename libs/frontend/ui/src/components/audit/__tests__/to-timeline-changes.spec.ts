import { describe, expect, it } from 'vitest';
import { toTimelineChanges } from '../entity-timeline';

describe('toTimelineChanges', () => {
  it('should keep entries shaped as { old, new } and drop anything else', () => {
    expect(
      toTimelineChanges({
        status: { old: 'ACTIVE', new: 'SUSPENDED' },
        name: { old: null, new: { en: 'Priya' } },
        stray: 'not a change',
        partial: { old: 1 },
      }),
    ).toEqual({
      status: { old: 'ACTIVE', new: 'SUSPENDED' },
      name: { old: null, new: { en: 'Priya' } },
    });
  });

  it('should pass null through', () => {
    expect(toTimelineChanges(null)).toBeNull();
  });
});
