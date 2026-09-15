import { renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import type { AcademicYear } from '@web/app/[locale]/institute/(dashboard)/academic-years/use-academic-years';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlledAcademicYearSelector, useLocalAcademicYear } from '../academic-year-picker';

const yearsState: { years: AcademicYear[]; loading: boolean } = { years: [], loading: false };

vi.mock('@web/app/[locale]/institute/(dashboard)/academic-years/use-academic-years', () => ({
  useAcademicYears: () => yearsState,
}));

function year(over: Partial<AcademicYear> & { id: string }): AcademicYear {
  return {
    __typename: 'AcademicYearModel',
    boardExamDates: {},
    createdAt: '2025-06-01T00:00:00.000Z',
    endDate: '2026-04-30',
    label: '2025-26',
    startDate: '2025-06-01',
    isActive: false,
    status: 'PLANNING',
    termStructure: [],
    updatedAt: '2025-06-01T00:00:00.000Z',
    ...over,
  };
}

const ACTIVE = year({ id: 'ay-active', label: '2025-26', isActive: true, status: 'ACTIVE' });
const PLANNING = year({ id: 'ay-next', label: '2026-27', isActive: false, status: 'PLANNING' });

// Mounted with NO nuqs provider on purpose: the local hook and the controlled
// selector must work without URL state (a useQueryState call would throw).
describe('useLocalAcademicYear', () => {
  beforeEach(() => {
    yearsState.years = [ACTIVE, PLANNING];
    yearsState.loading = false;
  });

  it('should default to the active year', () => {
    const { result } = renderHook(() => useLocalAcademicYear());

    expect(result.current.yearId).toBe('ay-active');
    expect(result.current.year?.label).toBe('2025-26');
  });

  it('should switch years via setYearId', () => {
    const { result, rerender } = renderHook(() => useLocalAcademicYear());

    result.current.setYearId('ay-next');
    rerender();

    expect(result.current.yearId).toBe('ay-next');
  });
});

describe('ControlledAcademicYearSelector', () => {
  beforeEach(() => {
    yearsState.years = [ACTIVE, PLANNING];
    yearsState.loading = false;
  });

  it('should call onChange with the picked year instead of touching the URL', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithProviders(<ControlledAcademicYearSelector value="ay-active" onChange={onChange} />);

    expect(screen.getByRole('button', { name: /2025-26/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /2025-26/ }));
    await user.click(screen.getByRole('button', { name: /2026-27/ }));

    expect(onChange).toHaveBeenCalledWith('ay-next');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
