import { MANUAL_RECONNECT_AFTER } from '@roviq/graphql';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { LiveConnectionIndicator } from '../live-connection-indicator';
import { LiveUpdatesBanner } from '../live-updates-banner';

const live = vi.hoisted(() => ({
  status: 'idle' as string,
  failedAttempts: 0,
  reconnectNow: vi.fn(),
  resume: vi.fn(),
}));
vi.mock('@roviq/graphql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@roviq/graphql')>()),
  useLiveConnection: () => live,
}));

const ids = testIds.liveUpdates;

function setLive(status: string, failedAttempts = 0) {
  live.status = status;
  live.failedAttempts = failedAttempts;
}

describe('LiveUpdatesBanner', () => {
  beforeEach(() => {
    live.reconnectNow.mockReset();
    setLive('idle');
  });

  it.each(['idle', 'connecting', 'connected'])('shows nothing while %s', (status) => {
    setLive(status);
    renderWithProviders(<LiveUpdatesBanner />);
    expect(screen.queryByTestId(ids.banner)).not.toBeInTheDocument();
  });

  it('says live updates are paused while reconnecting, without a button at first', () => {
    setLive('reconnecting', 1);
    renderWithProviders(<LiveUpdatesBanner />);

    const banner = screen.getByTestId(ids.banner);
    expect(banner).toHaveAttribute('role', 'status');
    expect(banner).toHaveTextContent('Live updates paused');
    expect(banner).toHaveTextContent('what you see may be out of date');
    expect(screen.queryByTestId(ids.reconnectBtn)).not.toBeInTheDocument();
  });

  it(`offers Reconnect after ${MANUAL_RECONNECT_AFTER} failed attempts, which connects now`, () => {
    setLive('reconnecting', MANUAL_RECONNECT_AFTER);
    renderWithProviders(<LiveUpdatesBanner />);

    expect(screen.getByTestId(ids.banner)).toHaveTextContent(
      `Still not connected after ${MANUAL_RECONNECT_AFTER} attempts`,
    );
    fireEvent.click(screen.getByTestId(ids.reconnectBtn));
    expect(live.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it('says the device is offline, with no button', () => {
    setLive('offline', 2);
    renderWithProviders(<LiveUpdatesBanner />);

    expect(screen.getByTestId(ids.banner)).toHaveTextContent("You're offline");
    expect(screen.queryByTestId(ids.reconnectBtn)).not.toBeInTheDocument();
  });

  it('says live updates stopped when the session ended, with Reconnect', () => {
    setLive('session-ended');
    renderWithProviders(<LiveUpdatesBanner />);

    expect(screen.getByTestId(ids.banner)).toHaveTextContent('Live updates stopped');
    fireEvent.click(screen.getByTestId(ids.reconnectBtn));
    expect(live.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it('is translated into Hindi', () => {
    setLive('reconnecting', MANUAL_RECONNECT_AFTER);
    renderWithProviders(<LiveUpdatesBanner />, { locale: 'hi' });

    expect(screen.getByTestId(ids.banner)).toHaveTextContent('लाइव अपडेट रुके हुए हैं');
    expect(screen.getByTestId(ids.reconnectBtn)).toHaveTextContent('रीकनेक्ट');
  });
});

describe('LiveConnectionIndicator', () => {
  it('shows nothing when the page has no live data', () => {
    setLive('idle');
    renderWithProviders(<LiveConnectionIndicator />);
    expect(screen.queryByTestId(ids.indicator)).not.toBeInTheDocument();
  });

  it.each([
    ['connected', 'Live updates on'],
    ['reconnecting', 'Live updates paused, reconnecting'],
    ['offline', 'Offline: no internet connection'],
    ['session-ended', 'Live updates stopped: sign in again'],
  ])('labels the %s state', (status, label) => {
    setLive(status);
    renderWithProviders(<LiveConnectionIndicator />);
    expect(screen.getByRole('img', { name: label })).toHaveAttribute('data-status', status);
  });
});
