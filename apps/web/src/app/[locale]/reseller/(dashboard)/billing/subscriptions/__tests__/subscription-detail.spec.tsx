import { screen } from '@testing-library/react';
import { renderWithProviders } from '@web/__test-utils__/render-with-providers';
import { describe, expect, it, vi } from 'vitest';
import { SubscriptionDetail } from '../subscription-detail';
import type { SubscriptionNode } from '../use-subscriptions';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NOW = '2026-11-21T00:00:00.000Z';

const subscription = (status: SubscriptionNode['status']): SubscriptionNode => ({
  id: 'sub-1',
  tenantId: 'inst-1',
  resellerId: 'reseller-1',
  planId: 'plan-1',
  institute: { id: 'inst-1', name: { en: 'Saraswati Vidya Mandir' } },
  plan: {
    id: 'plan-1',
    name: { en: 'Pro' },
    description: null,
    amount: '99900',
    currency: 'INR',
    interval: 'MONTHLY',
    entitlements: {},
    sortOrder: null,
    status: 'ACTIVE',
    subscriberCount: 1,
    trialDays: 0,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
  status,
  gatewaySubscriptionId: null,
  gatewayProvider: null,
  currentPeriodStart: NOW,
  currentPeriodEnd: '2026-12-21T00:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  pausedAt: null,
  pauseReason: null,
  trialEndsAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

describe('SubscriptionDetail actions', () => {
  it('offers Pause, not Resume, for an active subscription without a gateway id', () => {
    renderWithProviders(
      <SubscriptionDetail subscription={subscription('ACTIVE')} open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Pause Subscription' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume Subscription' })).not.toBeInTheDocument();
  });

  it('offers Resume, not Pause, for a paused subscription without a gateway id', () => {
    renderWithProviders(
      <SubscriptionDetail subscription={subscription('PAUSED')} open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: 'Resume Subscription' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause Subscription' })).not.toBeInTheDocument();
  });
});
