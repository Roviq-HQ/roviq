import { useAuth } from '@roviq/auth';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type RenderWithProvidersOptions,
  renderWithProviders,
} from '@web/__test-utils__/render-with-providers';
import { GraphQLError } from 'graphql';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResellerTeamPage from '../page';
import {
  ResellerAssignableTeamRolesDocument,
  ResellerChangeTeamMemberRoleDocument,
  ResellerDeactivateTeamMemberDocument,
  ResellerInviteTeamMemberDocument,
  ResellerTeamMemberActivityDocument,
  ResellerTeamMemberDocument,
  ResellerTeamMembersDocument,
} from '../use-reseller-team.generated';

vi.mock('@roviq/auth', () => ({ useAuth: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Select needs these in jsdom.
if (typeof Element.prototype.hasPointerCapture === 'undefined') {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}

const FULL = 'role-full';
const SUPPORT = 'role-support';
const VIEWER = 'role-viewer';

const ROLE_NAMES: Record<string, string> = {
  [FULL]: 'reseller_full_admin',
  [SUPPORT]: 'reseller_support_admin',
  [VIEWER]: 'reseller_viewer',
};

function member(overrides: Record<string, unknown>) {
  const roleId = (overrides.roleId as string | undefined) ?? VIEWER;
  return {
    __typename: 'ResellerTeamMemberModel',
    id: 'm-1',
    userId: 'u-1',
    email: 'person@team.test',
    username: 'person',
    roleId,
    roleName: { en: ROLE_NAMES[roleId] },
    isActive: true,
    joinedAt: '2026-03-05T00:00:00.000Z',
    lastActiveAt: null,
    canManage: true,
    profile: null,
    ...overrides,
  };
}

const me = member({
  id: 'm-me',
  userId: 'u-me',
  email: 'priya@team.test',
  username: 'priya.nair',
  roleId: FULL,
  canManage: false,
  profile: {
    __typename: 'ResellerTeamMemberProfileModel',
    firstName: { en: 'Priya' },
    lastName: { en: 'Nair' },
  },
});
const arjun = member({
  id: 'm-arjun',
  userId: 'u-arjun',
  email: 'arjun@team.test',
  username: 'arjun@team.test',
  roleId: SUPPORT,
});
const inactive = member({
  id: 'm-old',
  userId: 'u-old',
  email: 'old@team.test',
  username: 'old.member',
  isActive: false,
});

function listMock(nodes: ReturnType<typeof member>[], filter: Record<string, unknown> = {}) {
  return {
    request: {
      query: ResellerTeamMembersDocument,
      variables: { filter: { first: 20, ...filter } },
    },
    result: {
      data: {
        resellerListTeamMembers: {
          __typename: 'ResellerTeamMemberConnection',
          totalCount: nodes.length,
          pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null },
          edges: nodes.map((node) => ({
            __typename: 'ResellerTeamMemberEdge',
            cursor: node.id,
            node,
          })),
        },
      },
    },
  };
}

function rolesMock(roleIds: string[] = [FULL, SUPPORT, VIEWER]) {
  return {
    request: { query: ResellerAssignableTeamRolesDocument },
    result: {
      data: {
        resellerAssignableTeamRoles: roleIds.map((id) => ({
          __typename: 'ResellerTeamRoleModel',
          id,
          name: { en: ROLE_NAMES[id] },
        })),
      },
    },
  };
}

const MANAGER = [
  { action: 'read' as const, subject: 'all' as const },
  { action: 'manage' as const, subject: 'ResellerTeam' as const },
];

function renderPage(
  apolloMocks: RenderWithProvidersOptions['apolloMocks'],
  options: Pick<RenderWithProvidersOptions, 'abilityRules'> & { searchParams?: string } = {},
) {
  return renderWithProviders(
    <NuqsTestingAdapter searchParams={options.searchParams}>
      <ResellerTeamPage />
    </NuqsTestingAdapter>,
    { apolloMocks, abilityRules: options.abilityRules ?? MANAGER },
  );
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'u-me' } } as ReturnType<typeof useAuth>);
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe('ResellerTeamPage', () => {
  it('lists members with translated role and status, and marks the signed-in user', async () => {
    renderPage([listMock([me, arjun, inactive]), rolesMock()]);

    const mine = await screen.findByTestId('reseller-team-name-m-me');
    expect(mine).toHaveTextContent('Priya Nair');
    expect(mine).toHaveTextContent('priya.nair');
    expect(within(mine).getByTestId('reseller-team-you-badge')).toHaveTextContent('You');
    expect(screen.getByTestId('reseller-team-role-m-me')).toHaveTextContent('Reseller admin');
    expect(screen.getByTestId('reseller-team-role-m-arjun')).toHaveTextContent('Reseller support');
    expect(screen.getByTestId('reseller-team-status-m-arjun')).toHaveTextContent('Active');
    expect(screen.getByTestId('reseller-team-status-m-old')).toHaveTextContent('Inactive');
    expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();
    expect(screen.getAllByText('Never')).toHaveLength(3);
  });

  it('offers actions only on rows the caller may change', async () => {
    renderPage([listMock([me, arjun]), rolesMock()]);

    await screen.findByTestId('reseller-team-name-m-arjun');
    expect(screen.getByTestId('reseller-team-actions-m-arjun')).toBeInTheDocument();
    expect(screen.queryByTestId('reseller-team-actions-m-me')).not.toBeInTheDocument();
    expect(screen.getByTestId('reseller-team-invite-btn')).toBeInTheDocument();
  });

  it('hides invite and every row action from a read-only role', async () => {
    renderPage([listMock([me, arjun]), rolesMock([])], {
      abilityRules: [{ action: 'read', subject: 'all' }],
    });

    await screen.findByTestId('reseller-team-name-m-arjun');
    expect(screen.queryByTestId('reseller-team-invite-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reseller-team-actions-m-arjun')).not.toBeInTheDocument();
  });

  it('reads the status filter from the URL and sends it to the server', async () => {
    renderPage([listMock([inactive], { isActive: false }), rolesMock()], {
      searchParams: '?status=inactive',
    });

    expect(await screen.findByTestId('reseller-team-name-m-old')).toBeInTheDocument();
    expect(screen.getByTestId('reseller-team-clear-filters-btn')).toBeInTheDocument();
  });

  it('shows the no-match empty state when a filter finds nobody', async () => {
    renderPage([listMock([], { isActive: false }), rolesMock()], {
      searchParams: '?status=inactive',
    });

    const empty = await screen.findByTestId('reseller-team-empty');
    expect(empty).toHaveTextContent('No members match');
  });

  describe('invite', () => {
    // Sent trimmed; the server lower-cases it.
    const variables = { input: { email: 'New.Person@team.test', roleId: VIEWER } };

    async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByTestId('reseller-team-invite-btn'));
      await user.type(
        screen.getByTestId('reseller-team-invite-email-input'),
        ' New.Person@team.test',
      );
      await user.click(screen.getByTestId('reseller-team-invite-role-select'));
      await user.click(await screen.findByRole('option', { name: 'Reseller viewer' }));
      await user.click(screen.getByTestId('reseller-team-invite-submit-btn'));
    }

    it('sends the trimmed email and chosen role, then confirms and closes', async () => {
      const user = userEvent.setup();
      const invited = member({ id: 'm-new', userId: 'u-new', email: 'new.person@team.test' });
      renderPage([
        listMock([me]),
        rolesMock(),
        {
          request: { query: ResellerInviteTeamMemberDocument, variables },
          result: { data: { resellerInviteTeamMember: invited } },
        },
        listMock([me, invited]),
      ]);

      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('new.person@team.test was added to the team.'),
      );
      await waitFor(() =>
        expect(screen.queryByTestId('reseller-team-invite-dialog')).not.toBeInTheDocument(),
      );
      expect(await screen.findByTestId('reseller-team-name-m-new')).toBeInTheDocument();
    });

    it('keeps the dialog open and explains when the person is already on the team', async () => {
      const user = userEvent.setup();
      renderPage([
        listMock([me]),
        rolesMock(),
        {
          request: { query: ResellerInviteTeamMemberDocument, variables },
          result: {
            errors: [
              new GraphQLError('This person is already on the team', {
                extensions: { code: 'TEAM_MEMBER_ALREADY_EXISTS' },
              }),
            ],
          },
        },
      ]);

      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'This person is already on your team. If they are inactive, reactivate them from the list.',
        ),
      );
      expect(screen.getByTestId('reseller-team-invite-dialog')).toBeInTheDocument();
    });

    it('does not call the server for an address that is not an email', async () => {
      const user = userEvent.setup();
      renderPage([listMock([me]), rolesMock()]);

      await user.click(await screen.findByTestId('reseller-team-invite-btn'));
      await user.type(screen.getByTestId('reseller-team-invite-email-input'), 'not-an-email');
      await user.click(screen.getByTestId('reseller-team-invite-submit-btn'));

      expect(await screen.findByText('Invalid email address')).toBeInTheDocument();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('offers a support admin only the roles the server allows', async () => {
      const user = userEvent.setup();
      renderPage([listMock([me]), rolesMock([SUPPORT, VIEWER])]);

      await user.click(await screen.findByTestId('reseller-team-invite-btn'));
      await user.click(screen.getByTestId('reseller-team-invite-role-select'));

      const options = await screen.findAllByRole('option');
      expect(options.map((option) => option.textContent)).toEqual([
        'Reseller support',
        'Reseller viewer',
      ]);
    });
  });

  describe('row actions', () => {
    it('changes a role only once a different one is picked, and names the new role', async () => {
      const user = userEvent.setup();
      const changed = { ...arjun, roleId: VIEWER, roleName: { en: ROLE_NAMES[VIEWER] } };
      renderPage([
        listMock([me, arjun]),
        rolesMock(),
        {
          request: {
            query: ResellerChangeTeamMemberRoleDocument,
            variables: { membershipId: 'm-arjun', roleId: VIEWER },
          },
          result: { data: { resellerChangeTeamMemberRole: changed } },
        },
        listMock([me, changed]),
      ]);

      await user.click(await screen.findByTestId('reseller-team-actions-m-arjun'));
      await user.click(await screen.findByTestId('reseller-team-action-change-role'));

      const submit = await screen.findByTestId('reseller-team-role-submit-btn');
      expect(submit).toBeDisabled();
      expect(screen.getByTestId('reseller-team-role-dialog')).toHaveTextContent(
        'Change role of arjun@team.test',
      );

      await user.click(screen.getByTestId('reseller-team-role-select'));
      await user.click(await screen.findByRole('option', { name: 'Reseller viewer' }));
      expect(submit).toBeEnabled();
      await user.click(submit);

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith('arjun@team.test is now Reseller viewer.'),
      );
      expect(screen.queryByTestId('reseller-team-detail-sheet')).not.toBeInTheDocument();
    });

    it('confirms a deactivation by name and reports a refusal in plain words', async () => {
      const user = userEvent.setup();
      renderPage([
        listMock([me, arjun]),
        rolesMock(),
        {
          request: {
            query: ResellerDeactivateTeamMemberDocument,
            variables: { membershipId: 'm-arjun' },
          },
          result: {
            errors: [
              new GraphQLError('senior', { extensions: { code: 'TEAM_ROLE_NOT_ASSIGNABLE' } }),
            ],
          },
        },
      ]);

      await user.click(await screen.findByTestId('reseller-team-actions-m-arjun'));
      await user.click(await screen.findByTestId('reseller-team-action-deactivate'));

      const dialog = await screen.findByTestId('reseller-team-confirm-dialog');
      expect(dialog).toHaveTextContent('Deactivate arjun@team.test?');
      await user.click(screen.getByTestId('reseller-team-confirm-btn'));

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "This role is above what you, or your organisation's plan, can assign.",
        ),
      );
      expect(screen.getByTestId('reseller-team-confirm-dialog')).toBeInTheDocument();
    });

    it('offers Reactivate, not Deactivate, on an inactive member', async () => {
      const user = userEvent.setup();
      renderPage([listMock([me, inactive]), rolesMock()]);

      await user.click(await screen.findByTestId('reseller-team-actions-m-old'));

      expect(await screen.findByTestId('reseller-team-action-reactivate')).toBeInTheDocument();
      expect(screen.queryByTestId('reseller-team-action-deactivate')).not.toBeInTheDocument();
    });
  });

  describe('detail sheet', () => {
    const activityMock = {
      request: {
        query: ResellerTeamMemberActivityDocument,
        variables: { userId: 'u-arjun', first: 10 },
      },
      result: {
        data: {
          resellerAuditLogs: {
            __typename: 'AuditLogConnection',
            edges: [
              {
                __typename: 'AuditLogEdge',
                node: {
                  __typename: 'AuditLog',
                  id: 'log-1',
                  action: 'resellerSuspendInstitute',
                  actionType: 'SUSPEND',
                  entityType: 'Institute',
                  createdAt: '2026-03-06T10:15:00.000Z',
                },
              },
            ],
          },
        },
      },
    };

    function detailMock(sessions: Record<string, unknown>[] | null) {
      return {
        request: { query: ResellerTeamMemberDocument, variables: { membershipId: 'm-arjun' } },
        result: {
          data: {
            resellerGetTeamMember: {
              ...arjun,
              __typename: 'ResellerTeamMemberDetailModel',
              sessions,
            },
          },
        },
      };
    }

    it('opens from the URL with profile, sessions and recent activity', async () => {
      renderPage(
        [
          listMock([me, arjun]),
          rolesMock(),
          detailMock([
            {
              __typename: 'ResellerTeamSessionModel',
              id: 's-1',
              ipAddress: '10.0.0.7',
              userAgent: 'Firefox on Linux',
              createdAt: '2026-03-06T09:00:00.000Z',
              lastUsedAt: null,
              expiresAt: '2026-03-13T09:00:00.000Z',
            },
          ]),
          activityMock,
        ],
        { searchParams: '?member=m-arjun' },
      );

      const name = await screen.findByTestId('reseller-team-detail-name');
      await waitFor(() => expect(name).toHaveTextContent('arjun@team.test'));
      const session = await screen.findByTestId('reseller-team-session-s-1');
      expect(session).toHaveTextContent('Firefox on Linux');
      expect(session).toHaveTextContent('10.0.0.7');
      const entry = await screen.findByTestId('reseller-team-activity-log-1');
      expect(entry).toHaveTextContent('Suspend · Institute');
    });

    it('explains who can see sessions when the server withholds them', async () => {
      renderPage([listMock([me, arjun]), rolesMock([]), detailMock(null), activityMock], {
        searchParams: '?member=m-arjun',
        abilityRules: [{ action: 'read', subject: 'all' }],
      });

      const sessions = await screen.findByTestId('reseller-team-detail-sessions');
      await waitFor(() =>
        expect(sessions).toHaveTextContent(
          'You can see sessions only for yourself and for members you manage.',
        ),
      );
    });

    it('opens when a row is clicked', async () => {
      const user = userEvent.setup();
      renderPage([listMock([me, arjun]), rolesMock(), detailMock([]), activityMock]);

      await user.click(await screen.findByTestId('reseller-team-name-m-arjun'));

      expect(await screen.findByTestId('reseller-team-detail-sessions-empty')).toBeInTheDocument();
    });
  });
});
