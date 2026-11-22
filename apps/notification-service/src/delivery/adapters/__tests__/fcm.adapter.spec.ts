import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ChannelAdapterError, type ChannelMessage } from '../channel-adapter';
import { type DeviceTokenRetirer, FcmPushAdapter } from '../fcm.adapter';

const { getAccessToken } = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<{ token?: string | null }>>(),
}));
// The adapter only calls getAccessToken(); a fake JWT keeps the token request off the network.
vi.mock('google-auth-library', () => ({
  JWT: class {
    getAccessToken = getAccessToken;
  },
}));

const SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'roviq-test',
  client_email: 'push@roviq-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n',
});
const ENDPOINT = 'https://fcm.googleapis.com/v1/projects/roviq-test/messages:send';

const MESSAGE: ChannelMessage = {
  channel: 'PUSH',
  type: 'FEE_REMINDER',
  recipientUserId: 'user-guardian-1',
  to: ['token-a', 'token-b'],
  subject: 'Fee reminder',
  body: 'Tuition for April 2026 is due on 2026-04-20.',
  data: { feeId: 'fee-1', path: '/institute/dashboard' },
};

const ok = (name: string) => new Response(JSON.stringify({ name }), { status: 200 });
const refused = (status: number, errorCode: string) =>
  new Response(
    JSON.stringify({
      error: {
        status: 'NOT_FOUND',
        details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }],
      },
    }),
    { status },
  );

function sentBody(token: string) {
  return {
    message: {
      token,
      notification: { title: MESSAGE.subject, body: MESSAGE.body },
      data: MESSAGE.data,
    },
  };
}

describe('FcmPushAdapter', () => {
  let fetchMock: Mock<typeof fetch>;
  let retire: Mock<DeviceTokenRetirer['retireDeviceToken']>;
  let adapter: FcmPushAdapter;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    getAccessToken.mockResolvedValue({ token: 'ya29.test-token' });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    retire = vi.fn<DeviceTokenRetirer['retireDeviceToken']>().mockResolvedValue(undefined);
    adapter = new FcmPushAdapter(SERVICE_ACCOUNT, { retireDeviceToken: retire });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requests() {
    return fetchMock.mock.calls.map(([url, init]) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return {
        url,
        method: init?.method,
        headers: init?.headers,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      };
    });
  }

  it('should send to every device token and return the first message name', async () => {
    fetchMock
      .mockResolvedValueOnce(ok('projects/roviq-test/messages/1'))
      .mockResolvedValueOnce(ok('projects/roviq-test/messages/2'));

    const result = await adapter.send(MESSAGE);

    expect(result).toEqual({ providerMessageId: 'projects/roviq-test/messages/1' });
    const headers = { authorization: 'Bearer ya29.test-token', 'content-type': 'application/json' };
    expect(requests()).toEqual([
      { url: ENDPOINT, method: 'POST', headers, body: sentBody('token-a') },
      { url: ENDPOINT, method: 'POST', headers, body: sentBody('token-b') },
    ]);
    expect(retire).not.toHaveBeenCalled();
  });

  it('should retire an unregistered token once and still succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(refused(404, 'UNREGISTERED'))
      .mockResolvedValueOnce(ok('projects/roviq-test/messages/2'));

    const result = await adapter.send(MESSAGE);

    expect(result).toEqual({ providerMessageId: 'projects/roviq-test/messages/2' });
    expect(retire).toHaveBeenCalledTimes(1);
    expect(retire).toHaveBeenCalledWith('token-a');
  });

  it('should fail with the FCM error code when every token is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(refused(404, 'UNREGISTERED'))
      .mockResolvedValueOnce(refused(429, 'QUOTA_EXCEEDED'));

    const sending = adapter.send(MESSAGE);

    await expect(sending).rejects.toBeInstanceOf(ChannelAdapterError);
    await expect(sending).rejects.toHaveProperty('code', 'QUOTA_EXCEEDED');
    expect(retire).toHaveBeenCalledTimes(1);
    expect(retire).toHaveBeenCalledWith('token-a');
  });

  it('should fail with FCM_AUTH and send nothing when no access token is issued', async () => {
    getAccessToken.mockResolvedValue({ token: null });

    const sending = adapter.send(MESSAGE);

    await expect(sending).rejects.toBeInstanceOf(ChannelAdapterError);
    await expect(sending).rejects.toHaveProperty('code', 'FCM_AUTH');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should fail with FCM_AUTH when the token request throws', async () => {
    getAccessToken.mockRejectedValue(new Error('invalid_grant'));

    await expect(adapter.send(MESSAGE)).rejects.toHaveProperty('code', 'FCM_AUTH');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should fail with FCM_UNREACHABLE when the request times out or the network fails', async () => {
    fetchMock
      .mockRejectedValueOnce(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const sending = adapter.send(MESSAGE);

    await expect(sending).rejects.toBeInstanceOf(ChannelAdapterError);
    await expect(sending).rejects.toHaveProperty('code', 'FCM_UNREACHABLE');
    expect(retire).not.toHaveBeenCalled();
  });

  it('should refuse a malformed service account at construction', () => {
    expect(() => new FcmPushAdapter('{"project_id": "x"', { retireDeviceToken: retire })).toThrow(
      SyntaxError,
    );
    expect(
      () => new FcmPushAdapter(JSON.stringify({ project_id: 'x' }), { retireDeviceToken: retire }),
    ).toThrow('client_email');
  });

  it('should fail with NO_RECIPIENT when the recipient has no device token', async () => {
    await expect(adapter.send({ ...MESSAGE, to: [] })).rejects.toHaveProperty(
      'code',
      'NO_RECIPIENT',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
