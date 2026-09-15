import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StandardSectionSelect } from '../standard-section-select';

vi.mock('@web/app/[locale]/institute/(dashboard)/academics/use-academics', () => ({
  useStandards: () => ({ standards: [{ id: 'std-1', name: { en: 'Grade 10' } }] }),
  useSections: () => ({
    sections: [{ id: 'sec-1', displayLabel: 'Sec A', name: { en: 'Sec A' } }],
  }),
}));

// The selects mount with null ids and receive values on interaction: they must
// stay controlled throughout instead of flipping uncontrolled → controlled.
describe('standard section select', () => {
  it('should not warn about controlled/uncontrolled switching when picking values', async () => {
    // React warns via console.error, Radix via console.warn — cover both.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      function Harness() {
        const [sectionId, setSectionId] = useState<string | null>(null);
        return <StandardSectionSelect sectionId={sectionId} onSectionChange={setSectionId} />;
      }
      renderWithProviders(<Harness />);

      await user.click(screen.getByRole('combobox', { name: 'Standard' }));
      await user.click(await screen.findByRole('option', { name: 'Grade 10' }));
      await user.click(screen.getByRole('combobox', { name: 'Section' }));
      await user.click(await screen.findByRole('option', { name: 'Sec A' }));

      expect(screen.getByRole('combobox', { name: 'Section' })).toHaveTextContent('Sec A');

      const switches = [...errorSpy.mock.calls, ...warnSpy.mock.calls].filter((call) =>
        call.some((arg) =>
          /controlled to uncontrolled|uncontrolled to controlled/.test(String(arg)),
        ),
      );
      expect(switches).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
