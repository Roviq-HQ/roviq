import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';

// The shared setup renders `Link` as null; these tests assert its href.
vi.mock('next-intl/navigation', () => ({
  createNavigation: () => ({
    Link: ({ href, children, ...rest }: React.ComponentProps<'a'>) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
    redirect: vi.fn(),
    usePathname: vi.fn(() => '/'),
    useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
    getPathname: vi.fn(() => '/'),
  }),
}));

// Stand-ins for the real views: each shows which person it renders and a
// linked name, so the test can walk student → guardian → back.
vi.mock('../students/[id]/student-detail-view', async () => {
  const { PersonNameLink, usePersonDetailContext } = await import('../person-detail-dialog');
  return {
    StudentDetailView: ({ studentId }: { studentId: string }) => {
      const { embedded } = usePersonDetailContext();
      return (
        <div>
          <h2>{`student ${studentId} ${embedded ? 'embedded' : 'page'}`}</h2>
          <PersonNameLink kind="guardian" id="g-1">
            Rohit Mehta
          </PersonNameLink>
        </div>
      );
    },
  };
});
vi.mock('../guardians/[id]/guardian-detail-view', async () => {
  const { usePersonDetailContext } = await import('../person-detail-dialog');
  return {
    GuardianDetailView: ({ guardianId }: { guardianId: string }) => {
      const { embedded } = usePersonDetailContext();
      return <h2>{`guardian ${guardianId} ${embedded ? 'embedded' : 'page'}`}</h2>;
    },
  };
});

import { PersonDetailDialogProvider, PersonNameLink } from '../person-detail-dialog';

describe('PersonNameLink', () => {
  it('should link to the detail page when no popup provider is mounted', () => {
    renderWithProviders(
      <PersonNameLink kind="student" id="s-1">
        Aarav Mehta
      </PersonNameLink>,
    );

    expect(screen.getByTestId('person-link-student-s-1')).toHaveAttribute(
      'href',
      expect.stringContaining('/institute/people/students/s-1'),
    );
  });

  it('should open the person in the popup without triggering the clickable row behind it', async () => {
    const onRowClick = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <PersonDetailDialogProvider>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: stands in for a clickable table row */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: stands in for a clickable table row */}
        <div onClick={onRowClick}>
          <PersonNameLink kind="student" id="s-1">
            Aarav Mehta
          </PersonNameLink>
        </div>
      </PersonDetailDialogProvider>,
    );

    await user.click(screen.getByTestId('person-link-student-s-1'));

    const dialog = await screen.findByTestId('person-detail-dialog');
    expect(await within(dialog).findByText('student s-1 embedded')).toBeInTheDocument();
    expect(within(dialog).getByTestId('person-detail-dialog-open-page')).toHaveAttribute(
      'href',
      expect.stringContaining('/institute/people/students/s-1'),
    );
    expect(within(dialog).queryByTestId('person-detail-dialog-back')).not.toBeInTheDocument();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('should swap to a linked person inside the popup and go back to the previous one', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PersonDetailDialogProvider>
        <PersonNameLink kind="student" id="s-1">
          Aarav Mehta
        </PersonNameLink>
      </PersonDetailDialogProvider>,
    );
    await user.click(screen.getByTestId('person-link-student-s-1'));
    const dialog = await screen.findByTestId('person-detail-dialog');

    await user.click(await within(dialog).findByTestId('person-link-guardian-g-1'));

    expect(await within(dialog).findByText('guardian g-1 embedded')).toBeInTheDocument();
    expect(within(dialog).queryByText('student s-1 embedded')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('person-detail-dialog')).toHaveLength(1);

    await user.click(within(dialog).getByTestId('person-detail-dialog-back'));

    expect(await within(dialog).findByText('student s-1 embedded')).toBeInTheDocument();
    expect(within(dialog).queryByTestId('person-detail-dialog-back')).not.toBeInTheDocument();
  });
});
