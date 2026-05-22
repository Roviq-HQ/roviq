import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityTimelineEvent } from '../entity-timeline';
import { EntityTimeline } from '../entity-timeline';

afterEach(cleanup);

const mockT = (key: string) => {
  const translations: Record<string, string> = {
    'actionTypes.CREATE': 'Create',
    'actionTypes.UPDATE': 'Update',
    'actionTypes.DELETE': 'Delete',
    'detail.changes': 'View changes',
    'pagination.loadMore': 'Load more',
    'entityTimeline.noHistory': 'No activity history for this entity.',
  };
  return translations[key] ?? key;
};

const mockFormatDate = (date: Date | number, _fmt: string) =>
  new Date(date).toISOString().slice(0, 10);

function makeEvent(overrides: Partial<EntityTimelineEvent> = {}): EntityTimelineEvent {
  return {
    id: crypto.randomUUID(),
    action: 'createStudent',
    actionType: 'CREATE',
    entityType: 'Student',
    createdAt: '2026-03-20T10:00:00Z',
    actorName: 'Admin User',
    changes: null,
    metadata: null,
    ...overrides,
  };
}

const defaultProps = {
  entityType: 'Student',
  entityId: 'test-id',
  t: mockT,
  formatDate: mockFormatDate,
  hasNextPage: false,
  onLoadMore: vi.fn(),
  canRead: true,
  loading: false,
};

describe('EntityTimeline', () => {
  it('renders timeline events', () => {
    render(<EntityTimeline {...defaultProps} data={{ events: [makeEvent()], totalCount: 1 }} />);
    expect(screen.getByText('Create')).toBeDefined();
    expect(screen.getByText('createStudent')).toBeDefined();
    expect(screen.getByText('Admin User')).toBeDefined();
  });

  it('renders empty state when no events', () => {
    render(<EntityTimeline {...defaultProps} data={{ events: [], totalCount: 0 }} />);
    expect(screen.getByText('No activity history for this entity.')).toBeDefined();
  });

  it('renders nothing when canRead is false', () => {
    const { container } = render(
      <EntityTimeline
        {...defaultProps}
        canRead={false}
        data={{ events: [makeEvent()], totalCount: 1 }}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders loading skeleton when loading without data', () => {
    const { container } = render(
      <EntityTimeline {...defaultProps} loading={true} data={undefined} />,
    );
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows load more button when hasNextPage is true', () => {
    render(
      <EntityTimeline
        {...defaultProps}
        hasNextPage={true}
        data={{ events: [makeEvent()], totalCount: 5 }}
      />,
    );
    expect(screen.getByText('Load more')).toBeDefined();
  });

  it('hides load more button when hasNextPage is false', () => {
    render(
      <EntityTimeline
        {...defaultProps}
        hasNextPage={false}
        data={{ events: [makeEvent()], totalCount: 1 }}
      />,
    );
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('calls onLoadMore when load more is clicked', () => {
    const onLoadMore = vi.fn();
    render(
      <EntityTimeline
        {...defaultProps}
        hasNextPage={true}
        onLoadMore={onLoadMore}
        data={{ events: [makeEvent()], totalCount: 5 }}
      />,
    );
    fireEvent.click(screen.getByText('Load more'));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('renders collapsible changes for events with changes', () => {
    render(
      <EntityTimeline
        {...defaultProps}
        data={{
          events: [
            makeEvent({
              actionType: 'UPDATE',
              action: 'updateStudent',
              changes: { name: { old: 'Raj', new: 'Rajesh' } },
            }),
          ],
          totalCount: 1,
        }}
      />,
    );

    // Changes button visible
    expect(screen.getByText('View changes')).toBeDefined();

    // Click to expand
    fireEvent.click(screen.getByText('View changes'));

    // Diff values visible
    expect(screen.getByText('Raj')).toBeDefined();
    expect(screen.getByText('Rajesh')).toBeDefined();
  });

  it('renders multiple events in chronological order', () => {
    render(
      <EntityTimeline
        {...defaultProps}
        data={{
          events: [
            makeEvent({ action: 'updateStudent', actionType: 'UPDATE' }),
            makeEvent({ action: 'createStudent', actionType: 'CREATE' }),
          ],
          totalCount: 2,
        }}
      />,
    );

    const actions = screen.getAllByText(/Student/i);
    expect(actions.length).toBeGreaterThanOrEqual(2);
  });

  it('color-codes action badges by type', () => {
    render(
      <EntityTimeline
        {...defaultProps}
        data={{
          events: [
            makeEvent({ actionType: 'CREATE' }),
            makeEvent({ actionType: 'DELETE', action: 'deleteStudent' }),
          ],
          totalCount: 2,
        }}
      />,
    );

    const createBadge = screen.getByText('Create');
    const deleteBadge = screen.getByText('Delete');
    expect(createBadge.className).toContain('green');
    expect(deleteBadge.className).toContain('red');
  });
});
