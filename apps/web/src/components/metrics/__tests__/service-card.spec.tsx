import { testIds } from '@roviq/ui/testing/testid-registry';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServiceCard, type ServiceCardLabels } from '../service-card';

const { metrics } = testIds;

const LABELS: ServiceCardLabels = {
  status: { healthy: 'Healthy', degraded: 'Degraded', down: 'Down' },
  responseTime: 'Response time',
  uptime: 'Uptime',
  unknown: '—',
};

describe('ServiceCard', () => {
  it('should show the status as text, response time and uptime', () => {
    render(
      <ServiceCard
        serviceKey="REDIS"
        name="Redis"
        status="healthy"
        responseTime="4 ms"
        uptime="99.9%"
        labels={LABELS}
      />,
    );

    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByTestId(metrics.serviceStatus('REDIS'))).toHaveTextContent('Healthy');
    expect(screen.getByTestId(metrics.serviceResponse('REDIS'))).toHaveTextContent('4 ms');
    expect(screen.getByTestId(metrics.serviceUptime('REDIS'))).toHaveTextContent('99.9%');
  });

  it('should render the unknown label for null metrics when a service is down', () => {
    render(
      <ServiceCard
        serviceKey="NATS"
        name="NATS"
        status="down"
        responseTime={null}
        uptime={null}
        labels={LABELS}
      />,
    );

    expect(screen.getByTestId(metrics.serviceStatus('NATS'))).toHaveTextContent('Down');
    expect(screen.getByTestId(metrics.serviceResponse('NATS'))).toHaveTextContent('—');
    expect(screen.getByTestId(metrics.serviceUptime('NATS'))).toHaveTextContent('—');
  });

  it('should label a degraded service in text, not only by colour', () => {
    render(
      <ServiceCard
        serviceKey="POSTGRES"
        name="PostgreSQL"
        status="degraded"
        responseTime="812 ms"
        uptime="98%"
        labels={LABELS}
      />,
    );

    expect(screen.getByTestId(metrics.serviceStatus('POSTGRES'))).toHaveTextContent('Degraded');
  });
});
