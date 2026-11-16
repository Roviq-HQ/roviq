import { createMock } from '@roviq/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../lib/auth-context';
import { useSessions } from '../lib/use-sessions';

vi.mock('../lib/auth-context', () => ({ useAuth: vi.fn() }));

function setup() {
  const getAccessToken = vi.fn().mockReturnValue('access');
  const getRefreshToken = vi.fn().mockReturnValue('refresh');
  vi.mocked(useAuth).mockReturnValue(
    createMock<ReturnType<typeof useAuth>>({
      getAccessToken,
      getRefreshToken,
    }),
  );
  const options = {
    fetchSessions: vi.fn().mockResolvedValue([]),
    revokeSessionMutation: vi.fn().mockResolvedValue(true),
    revokeAllOtherSessionsMutation: vi.fn().mockResolvedValue(true),
  };
  const hook = renderHook(() => useSessions(options));
  return { ...hook, options, getAccessToken, getRefreshToken };
}

beforeEach(() => vi.resetAllMocks());

describe('useSessions', () => {
  it('should read the latest refresh token for revocation and reload sessions', async () => {
    const { result, options, getRefreshToken } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(options.fetchSessions).toHaveBeenCalledWith('access', 'refresh');
    getRefreshToken.mockReturnValue('rotated-refresh');

    await act(() => result.current.revokeAllOtherSessions());

    expect(options.revokeAllOtherSessionsMutation).toHaveBeenCalledWith(
      'access',
      'rotated-refresh',
    );
    expect(options.fetchSessions).toHaveBeenLastCalledWith('access', 'rotated-refresh');
    expect(options.fetchSessions).toHaveBeenCalledTimes(2);
  });

  it('should reject revocation when no refresh token exists', async () => {
    const { result, options, getRefreshToken } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    getRefreshToken.mockReturnValue(null);

    await expect(result.current.revokeAllOtherSessions()).rejects.toThrow('No active session');

    expect(options.revokeAllOtherSessionsMutation).not.toHaveBeenCalled();
  });

  it('should expose a load failure and allow retry', async () => {
    const { result, options } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    options.fetchSessions.mockRejectedValueOnce(new Error('Offline'));

    await act(() => result.current.refetch());
    expect(result.current.error).toBe('Offline');
    await act(() => result.current.refetch());

    expect(result.current.error).toBeNull();
    expect(result.current.sessions).toEqual([]);
  });

  it('should reject a single-session revocation without reporting success', async () => {
    const { result, options } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    options.revokeSessionMutation.mockRejectedValueOnce(new Error('Forbidden'));

    await expect(result.current.revokeSession('other')).rejects.toThrow('Forbidden');

    expect(options.fetchSessions).toHaveBeenCalledTimes(1);
  });
});
