import { testIds } from '@roviq/ui/testing/testid-registry';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../../../../__test-utils__/render-with-providers';
import { AlertsPanel } from '../_components/alerts-panel';
import { DlqBanner } from '../_components/dlq-banner';
import { NatsLagPanel } from '../_components/nats-lag-panel';
import { ServiceStatusGrid } from '../_components/service-status-grid';
import type { SystemHealthFieldsFragment } from '../_lib/system-health.graphql.generated';

const { adminMonitoring: ids, metrics } = testIds;

const SERVICES: SystemHealthFieldsFragment['services'] = [
  {
    __typename: 'ServiceHealth',
    name: 'API_GATEWAY',
    status: 'HEALTHY',
    responseMs: 12.4,
    uptimePercent: 100,
    checkedAt: '2026-11-18T10:00:00.000Z',
  },
  {
    __typename: 'ServiceHealth',
    name: 'POSTGRES',
    status: 'DEGRADED',
    responseMs: 812,
    uptimePercent: 99.456,
    checkedAt: '2026-11-18T10:00:00.000Z',
  },
  {
    __typename: 'ServiceHealth',
    name: 'OBJECT_STORAGE',
    status: 'DOWN',
    responseMs: null,
    uptimePercent: null,
    checkedAt: '2026-11-18T10:00:00.000Z',
  },
];

describe('ServiceStatusGrid', () => {
  it('should map each status to its text and format the metrics', () => {
    renderWithProviders(<ServiceStatusGrid services={SERVICES} />);

    expect(screen.getByTestId(metrics.serviceStatus('API_GATEWAY'))).toHaveTextContent('Healthy');
    expect(screen.getByTestId(metrics.serviceResponse('API_GATEWAY'))).toHaveTextContent('12 ms');
    expect(screen.getByTestId(metrics.serviceStatus('POSTGRES'))).toHaveTextContent('Degraded');
    expect(screen.getByTestId(metrics.serviceUptime('POSTGRES'))).toHaveTextContent('99.46%');
    expect(screen.getByTestId(metrics.serviceStatus('OBJECT_STORAGE'))).toHaveTextContent('Down');
    expect(screen.getByTestId(metrics.serviceResponse('OBJECT_STORAGE'))).toHaveTextContent('—');
    expect(screen.getByText('Object storage')).toBeInTheDocument();
  });

  it('should render in Hindi', () => {
    renderWithProviders(<ServiceStatusGrid services={SERVICES} />, { locale: 'hi' });

    expect(screen.getByText('सेवाएँ')).toBeInTheDocument();
    expect(screen.getByTestId(metrics.serviceStatus('API_GATEWAY'))).toHaveTextContent('ठीक');
    expect(screen.getByTestId(metrics.serviceStatus('OBJECT_STORAGE'))).toHaveTextContent('बंद');
  });

  it('should show a busy skeleton before the first snapshot', () => {
    renderWithProviders(<ServiceStatusGrid services={undefined} />);

    expect(screen.getByRole('status', { name: 'Loading service health' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
});

describe('AlertsPanel', () => {
  it('should say metrics are unavailable rather than all clear when OpenObserve is down', () => {
    renderWithProviders(<AlertsPanel health={{ alerts: [], alertsAvailable: false }} />);

    expect(screen.getByTestId(ids.alertsUnavailable)).toBeInTheDocument();
    expect(screen.queryByTestId(ids.alertsEmpty)).not.toBeInTheDocument();
  });

  it('should list firing alerts with a severity label', () => {
    renderWithProviders(
      <AlertsPanel
        health={{
          alertsAvailable: true,
          alerts: [
            {
              __typename: 'ActiveAlert',
              name: 'HighErrorRate',
              severity: 'CRITICAL',
              message: '5xx above 5%',
              since: '2026-11-18T09:30:00.000Z',
              runbook: null,
              stillTrue: true,
              affected: [],
            },
          ],
        }}
      />,
    );

    const item = screen.getByTestId(ids.alertItem('HighErrorRate'));
    expect(item).toHaveTextContent('Critical');
    // A rule without copy falls back to the description the metrics store holds.
    expect(item).toHaveTextContent('5xx above 5%');
    expect(screen.queryByTestId(ids.alertAction('HighErrorRate'))).not.toBeInTheDocument();
  });

  const canary = (stillTrue: boolean) => ({
    __typename: 'ActiveAlert' as const,
    name: 'notification_canary_missing',
    severity: 'CRITICAL' as const,
    message: 'The delivery canary has not been accepted on a channel.',
    since: '2026-11-18T09:30:00.000Z',
    runbook: 'docs/runbooks/notification-delivery.md#canary-missing',
    stillTrue,
    affected: stillTrue
      ? [{ __typename: 'AlertLabel' as const, label: 'channel', value: 'WHATSAPP' }]
      : [],
  });

  it('should name the channel, the impact, the steps, the screen and the runbook', () => {
    renderWithProviders(<AlertsPanel health={{ alertsAvailable: true, alerts: [canary(true)] }} />);

    const name = 'notification_canary_missing';
    const item = screen.getByTestId(ids.alertItem(name));
    expect(item).toHaveTextContent('Test message not delivered');
    expect(screen.getByTestId(ids.alertAffected(name))).toHaveTextContent('WhatsApp');
    expect(item).toHaveTextContent('Real messages on this channel are probably not arriving.');
    expect(screen.getByTestId(ids.alertSteps(name)).querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByTestId(ids.alertAction(name))).toHaveAttribute(
      'href',
      expect.stringMatching(/\/admin\/monitoring#notification-delivery$/),
    );
    expect(screen.getByTestId(ids.alertRunbook(name))).toHaveAttribute(
      'href',
      'https://github.com/Roviq-HQ/roviq/blob/main/docs/runbooks/notification-delivery.md#canary-missing',
    );
    expect(screen.queryByTestId(ids.alertRecovered(name))).not.toBeInTheDocument();
  });

  it('should show a rule whose query no longer passes as recovered, without steps', () => {
    renderWithProviders(
      <AlertsPanel health={{ alertsAvailable: true, alerts: [canary(false)] }} />,
    );

    const name = 'notification_canary_missing';
    expect(screen.getByTestId(ids.alertRecovered(name))).toHaveTextContent(
      'Recovered, closing at the next check',
    );
    expect(screen.queryByTestId(ids.alertSteps(name))).not.toBeInTheDocument();
    expect(screen.queryByTestId(ids.alertAction(name))).not.toBeInTheDocument();
  });

  it('should show the whole card in Hindi', () => {
    renderWithProviders(
      <AlertsPanel health={{ alertsAvailable: true, alerts: [canary(true)] }} />,
      {
        locale: 'hi',
      },
    );

    const item = screen.getByTestId(ids.alertItem('notification_canary_missing'));
    expect(item).toHaveTextContent('परीक्षण संदेश नहीं पहुँचा');
    expect(item).toHaveTextContent('रनबुक');
    expect(item).toHaveTextContent('सूचना वितरण खोलें');
  });

  it('should render in Hindi', () => {
    renderWithProviders(<AlertsPanel health={{ alerts: [], alertsAvailable: true }} />, {
      locale: 'hi',
    });

    expect(screen.getByTestId(ids.alertsEmpty)).toHaveTextContent('कोई अलर्ट सक्रिय नहीं है।');
  });
});

describe('DlqBanner', () => {
  it('should link to the DLQ tab when events are pending', () => {
    renderWithProviders(<DlqBanner count={3} />);

    expect(screen.getByTestId(ids.dlqBanner)).toHaveTextContent('3 failed events are waiting');
    expect(screen.getByTestId(ids.dlqLink)).toHaveAttribute(
      'href',
      expect.stringMatching(/\/admin\/observability\?tab=dlq$/),
    );
  });

  it('should render nothing when the queue is empty', () => {
    renderWithProviders(<DlqBanner count={0} />);

    expect(screen.queryByTestId(ids.dlqBanner)).not.toBeInTheDocument();
  });
});

describe('NatsLagPanel', () => {
  it('should list backlogged streams first', () => {
    renderWithProviders(
      <NatsLagPanel
        streams={[
          { __typename: 'NatsStreamLag', name: 'AUDIT', consumerLag: 0 },
          { __typename: 'NatsStreamLag', name: 'BILLING', consumerLag: 42 },
        ]}
        history={[]}
      />,
    );

    const items = within(screen.getByTestId(ids.natsPanel)).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('BILLING');
    expect(items[0]).toHaveTextContent('42 pending');
    expect(items[1]).toHaveTextContent('AUDIT');
  });
});
