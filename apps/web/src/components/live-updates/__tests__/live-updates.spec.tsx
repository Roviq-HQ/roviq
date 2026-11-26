import { MANUAL_RECONNECT_AFTER } from '@roviq/graphql';
import { TooltipProvider } from '@roviq/ui';
import { testIds } from '@roviq/ui/testing/testid-registry';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../__test-utils__/render-with-providers';
import { LiveConnectionIndicator } from '../live-connection-indicator';
import { LiveUpdatesBanner, RECONNECTING_BANNER_DELAY_MS } from '../live-updates-banner';

const live = vi.hoisted(() => ({
  status: 'idle' as string,
  failedAttempts: 0,
  reconnectNow: vi.fn(),
  resume: vi.fn(),
  noteRefetched: vi.fn(),
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

const liveRegion = () => screen.getByRole('status');

describe('LiveUpdatesBanner', () => {
  beforeEach(() => {
    live.reconnectNow.mockReset();
    setLive('idle');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['idle', 'connecting', 'connected'])('shows nothing while %s', (status) => {
    setLive(status);
    renderWithProviders(<LiveUpdatesBanner />);
    expect(screen.queryByTestId(ids.banner)).not.toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('');
  });

  it('waits out a short drop before saying live updates are paused', () => {
    vi.useFakeTimers();
    setLive('reconnecting', 1);
    renderWithProviders(<LiveUpdatesBanner />);
    expect(screen.queryByTestId(ids.banner)).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(RECONNECTING_BANNER_DELAY_MS));

    const banner = screen.getByTestId(ids.banner);
    expect(banner).toHaveTextContent('Live updates paused.');
    expect(banner).toHaveTextContent('what you see may be out of date');
    expect(screen.queryByTestId(ids.reconnectBtn)).not.toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Live updates paused, reconnecting.');
  });

  it(`offers Reconnect after ${MANUAL_RECONNECT_AFTER} failed attempts, keeping the count out of the announcement`, () => {
    vi.useFakeTimers();
    setLive('reconnecting', MANUAL_RECONNECT_AFTER);
    renderWithProviders(<LiveUpdatesBanner />);
    act(() => vi.advanceTimersByTime(RECONNECTING_BANNER_DELAY_MS));

    expect(screen.getByTestId(ids.banner)).toHaveTextContent(
      `Tried ${MANUAL_RECONNECT_AFTER} times.`,
    );
    expect(liveRegion()).not.toHaveTextContent(String(MANUAL_RECONNECT_AFTER));
    fireEvent.click(screen.getByTestId(ids.reconnectBtn));
    expect(live.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it('says the device is offline at once, with no button', () => {
    setLive('offline', 2);
    renderWithProviders(<LiveUpdatesBanner />);

    expect(screen.getByTestId(ids.banner)).toHaveTextContent("You're offline.");
    expect(screen.queryByTestId(ids.reconnectBtn)).not.toBeInTheDocument();
  });

  it('says the server stopped live updates, with Reconnect and no attempt count', () => {
    setLive('stopped', 0);
    renderWithProviders(<LiveUpdatesBanner />);

    const banner = screen.getByTestId(ids.banner);
    expect(banner).toHaveTextContent('The server closed the live connection');
    expect(banner).not.toHaveTextContent('Tried');
    fireEvent.click(screen.getByTestId(ids.reconnectBtn));
    expect(live.reconnectNow).toHaveBeenCalledTimes(1);
  });

  it('says live updates stopped when the session ended, with Reconnect', () => {
    setLive('session-ended');
    renderWithProviders(<LiveUpdatesBanner />);

    expect(screen.getByTestId(ids.banner)).toHaveTextContent('Live updates stopped.');
    expect(screen.getByTestId(ids.reconnectBtn)).toBeInTheDocument();
  });

  it('tells a view-as tab to close, without asking to sign in or reconnect', () => {
    setLive('impersonation-ended');
    renderWithProviders(<LiveUpdatesBanner />);

    const banner = screen.getByTestId(ids.banner);
    expect(banner).toHaveTextContent('Close this tab');
    expect(banner).not.toHaveTextContent(/sign in/i);
    expect(screen.queryByTestId(ids.reconnectBtn)).not.toBeInTheDocument();
  });

  it('announces once when live updates come back', () => {
    setLive('offline');
    const view = renderWithProviders(<LiveUpdatesBanner />);
    setLive('connected');
    view.rerender(<LiveUpdatesBanner />);

    expect(screen.queryByTestId(ids.banner)).not.toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('Live updates are back.');
  });

  it('is translated into Hindi', () => {
    setLive('stopped');
    renderWithProviders(<LiveUpdatesBanner />, { locale: 'hi' });

    expect(screen.getByTestId(ids.banner)).toHaveTextContent('लाइव अपडेट बंद हो गए।');
    expect(screen.getByTestId(ids.reconnectBtn)).toHaveTextContent('रीकनेक्ट');
  });
});

describe('LiveConnectionIndicator', () => {
  const renderIndicator = () =>
    renderWithProviders(
      <TooltipProvider>
        <LiveConnectionIndicator />
      </TooltipProvider>,
    );

  it('keeps its slot but shows nothing when the page has no live data', () => {
    setLive('idle');
    const { container } = renderIndicator();
    expect(screen.queryByTestId(ids.indicator)).not.toBeInTheDocument();
    expect(container.querySelector('span.size-9')).toBeInTheDocument();
  });

  it.each([
    ['connected', 'Live updates on'],
    ['reconnecting', 'Live updates paused, reconnecting'],
    ['stopped', 'Live updates stopped: press Reconnect'],
    ['offline', 'Offline: no internet connection'],
    ['session-ended', 'Live updates stopped: sign in again'],
  ])('labels the %s state on a focusable control', (status, label) => {
    setLive(status);
    renderIndicator();
    const control = screen.getByRole('button', { name: label });
    expect(control).toHaveAttribute('data-status', status);
    control.focus();
    expect(control).toHaveFocus();
  });
});
