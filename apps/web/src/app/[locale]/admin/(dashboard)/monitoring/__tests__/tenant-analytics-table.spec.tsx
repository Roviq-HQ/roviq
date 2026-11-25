import type { MockedResponse } from '@apollo/client/testing';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import { TENANT_PAGE_SIZE, TenantAnalyticsTable } from '../_components/tenant-analytics-table';
import {
  AdminMonitoringResellersDocument,
  type AdminMonitoringResellersQuery,
  AdminTenantAnalyticsDocument,
  type AdminTenantAnalyticsQuery,
  type AdminTenantAnalyticsQueryVariables,
} from '../_lib/tenant-analytics.graphql.generated';

const { adminMonitoring: ids, metrics } = testIds;

type Node = AdminTenantAnalyticsQuery['adminTenantAnalytics']['edges'][number]['node'];

const ALPHA: Node = {
  __typename: 'TenantAnalytics',
  instituteId: 'inst-alpha',
  instituteName: { en: 'Alpha Public Institute', hi: 'अल्फ़ा पब्लिक संस्थान' },
  resellerId: 'res-1',
  resellerName: 'Roviq Direct',
  activeUsers24h: 12,
  storageUsedBytes: 1288490189,
  apiCalls24h: 3400,
  activityTrend7d: [100, 200, 300, 250, 400, 500, 3400],
};

const BETA: Node = {
  __typename: 'TenantAnalytics',
  instituteId: 'inst-beta',
  instituteName: { en: 'Beta Academy' },
  resellerId: 'res-2',
  resellerName: 'Partner Edu',
  activeUsers24h: 0,
  storageUsedBytes: 0,
  apiCalls24h: null,
  activityTrend7d: null,
};

const RESELLERS: MockedResponse<AdminMonitoringResellersQuery> = {
  request: { query: AdminMonitoringResellersDocument },
  result: {
    data: {
      __typename: 'Query',
      adminListResellers: {
        __typename: 'AdminResellerConnection',
        edges: [
          {
            __typename: 'AdminResellerEdge',
            node: { __typename: 'AdminResellerModel', id: 'res-1', name: 'Roviq Direct' },
          },
          {
            __typename: 'AdminResellerEdge',
            node: { __typename: 'AdminResellerModel', id: 'res-2', name: 'Partner Edu' },
          },
        ],
      },
    },
  },
};

function analytics(
  variables: Partial<AdminTenantAnalyticsQueryVariables>,
  nodes: Node[],
  options: { metricsAvailable?: boolean; hasNextPage?: boolean } = {},
): MockedResponse<AdminTenantAnalyticsQuery> {
  return {
    request: {
      query: AdminTenantAnalyticsDocument,
      variables: {
        first: TENANT_PAGE_SIZE,
        after: null,
        sortBy: 'API_CALLS_24H',
        sortOrder: 'DESC',
        resellerId: null,
        ...variables,
      },
    },
    result: {
      data: {
        __typename: 'Query',
        adminTenantAnalytics: {
          __typename: 'TenantAnalyticsConnection',
          edges: nodes.map((node) => ({
            __typename: 'TenantAnalyticsEdge',
            cursor: `cursor-${node.instituteId}`,
            node,
          })),
          pageInfo: {
            __typename: 'PageInfo',
            hasNextPage: options.hasNextPage ?? false,
            endCursor: nodes.length > 0 ? `cursor-${nodes.at(-1)?.instituteId}` : null,
          },
          totalCount: nodes.length,
          metricsAvailable: options.metricsAvailable ?? true,
        },
      },
    },
  };
}

function renderTable(
  mocks: MockedResponse[],
  searchParams = '',
  onUrlUpdate: (e: UrlUpdateEvent) => void = () => undefined,
) {
  return renderWithProviders(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <TenantAnalyticsTable />
    </NuqsTestingAdapter>,
    { apolloMocks: [RESELLERS, ...mocks] },
  );
}

describe('TenantAnalyticsTable', () => {
  it('should render each institute with its resolved name, counts and trend', async () => {
    renderTable([analytics({}, [ALPHA, BETA])]);

    const alpha = await screen.findByTestId(ids.tenantRow('inst-alpha'));
    expect(within(alpha).getAllByText('Alpha Public Institute').length).toBeGreaterThan(0);
    expect(within(alpha).getByText('3,400')).toBeInTheDocument();
    expect(within(alpha).getByTestId(metrics.sparkline)).toHaveAttribute(
      'data-points',
      '100,200,300,250,400,500,3400',
    );
    expect(screen.getByTestId(ids.tenantPageInfo)).toHaveTextContent('1–2 of 2');
  });

  it('should show storage in a readable unit, and — for an institute with no files', async () => {
    renderTable([analytics({}, [ALPHA, BETA])]);

    expect(await screen.findByTestId(ids.tenantStorage('inst-alpha'))).toHaveTextContent('1.2 GB');
    expect(screen.getByTestId(ids.tenantStorage('inst-beta'))).toHaveTextContent('—');
  });

  it('should render — for null API calls and a missing trend', async () => {
    renderTable([analytics({}, [BETA])]);

    const beta = await screen.findByTestId(ids.tenantRow('inst-beta'));
    const cells = within(beta).getAllByRole('cell');
    expect(cells[2]).toHaveTextContent('0');
    expect(cells[3]).toHaveTextContent('—');
    expect(within(beta).getByTestId(metrics.sparklineEmpty)).toHaveTextContent('—');
  });

  it('should explain when API call metrics are unavailable', async () => {
    renderTable([analytics({}, [BETA], { metricsAvailable: false })]);

    expect(await screen.findByTestId(ids.tenantMetricsUnavailable)).toHaveTextContent(
      'API call counts are unavailable: the metrics store (OpenObserve) does not answer.',
    );
  });

  it('should sort by institute name A→Z and write the sort to the URL', async () => {
    const onUrlUpdate = vi.fn<(e: UrlUpdateEvent) => void>();
    renderTable(
      [
        analytics({}, [ALPHA, BETA]),
        analytics({ sortBy: 'INSTITUTE_NAME', sortOrder: 'ASC' }, [BETA, ALPHA]),
      ],
      '',
      onUrlUpdate,
    );
    await screen.findByTestId(ids.tenantRow('inst-alpha'));

    await userEvent.click(screen.getByTestId(ids.tenantSort('INSTITUTE_NAME')));

    const last = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(last?.searchParams.get('sort')).toBe('INSTITUTE_NAME');
    expect(last?.searchParams.get('order')).toBe('ASC');
  });

  it('should query only the reseller in the URL and say so when it has no institutes', async () => {
    renderTable([analytics({ resellerId: 'res-2' }, [])], '?reseller=res-2');

    expect(await screen.findByTestId(ids.tenantEmpty)).toHaveTextContent(
      'No institutes for this reseller.',
    );
  });

  it('should page forward with the end cursor and back again', async () => {
    renderTable([
      analytics({}, [ALPHA], { hasNextPage: true }),
      analytics({ after: 'cursor-inst-alpha' }, [BETA]),
      analytics({}, [ALPHA], { hasNextPage: true }),
    ]);
    await screen.findByTestId(ids.tenantRow('inst-alpha'));
    expect(screen.getByTestId(ids.tenantPrevPage)).toBeDisabled();

    await userEvent.click(screen.getByTestId(ids.tenantNextPage));

    expect(await screen.findByTestId(ids.tenantRow('inst-beta'))).toBeInTheDocument();
    expect(screen.getByTestId(ids.tenantPageInfo)).toHaveTextContent(
      `${TENANT_PAGE_SIZE + 1}–${TENANT_PAGE_SIZE + 1} of 1`,
    );

    await userEvent.click(screen.getByTestId(ids.tenantPrevPage));
    expect(await screen.findByTestId(ids.tenantRow('inst-alpha'))).toBeInTheDocument();
  });

  it('should show translated copy for a permission error, never the server message', async () => {
    renderTable([
      {
        request: analytics({}, []).request,
        result: {
          errors: [new GraphQLError('internal detail', { extensions: { code: 'FORBIDDEN' } })],
        },
      },
    ]);

    const error = await screen.findByTestId(ids.tenantError);
    expect(error).toHaveTextContent('You do not have permission to view system health.');
    expect(error).not.toHaveTextContent('internal detail');
  });
});
