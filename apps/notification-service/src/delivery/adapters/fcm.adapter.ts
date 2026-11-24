import { Logger } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import { z } from 'zod';
import { type AdapterErrorCode, FCM_ERROR_KINDS, type FcmErrorCode } from './adapter-errors';
import {
  type ChannelAdapter,
  ChannelAdapterError,
  type ChannelMessage,
  type ChannelSendResult,
} from './channel-adapter';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_REQUEST_TIMEOUT_MS = 15_000;

const serviceAccountSchema = z.object({
  project_id: z.string().min(1),
  client_email: z.string().min(1),
  private_key: z.string().min(1),
});

const fcmErrorSchema = z.object({
  error: z.object({
    status: z.string().optional(),
    details: z
      .array(z.object({ '@type': z.string().optional(), errorCode: z.string().optional() }))
      .optional(),
  }),
});

const fcmSuccessSchema = z.object({ name: z.string() });

export interface DeviceTokenRetirer {
  retireDeviceToken(token: string): Promise<void>;
}

/** Parses `FCM_SERVICE_ACCOUNT_JSON`; throws at startup when it is malformed. */
export function parseServiceAccount(json: string): z.infer<typeof serviceAccountSchema> {
  return serviceAccountSchema.parse(JSON.parse(json));
}

/**
 * Push through FCM HTTP v1. Sends to every device token of the recipient; a token FCM reports
 * as unregistered is soft-deleted so it is not tried again.
 */
export class FcmPushAdapter implements ChannelAdapter {
  readonly channel = 'PUSH';
  readonly provider = 'fcm';
  private readonly logger = new Logger(FcmPushAdapter.name);
  private readonly jwt: JWT;
  private readonly endpoint: string;

  constructor(
    serviceAccountJson: string,
    private readonly tokens: DeviceTokenRetirer,
  ) {
    const account = parseServiceAccount(serviceAccountJson);
    this.jwt = new JWT({
      email: account.client_email,
      key: account.private_key,
      scopes: [FCM_SCOPE],
    });
    this.endpoint = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  }

  async send(message: ChannelMessage): Promise<ChannelSendResult> {
    if (message.to.length === 0) {
      throw new ChannelAdapterError('NO_RECIPIENT', 'push message has no device token');
    }
    const accessToken = await this.accessToken();
    let firstId: string | undefined;
    let lastCode: AdapterErrorCode = 'FCM_REJECTED';
    for (const token of message.to) {
      const outcome = await this.sendOne(accessToken, token, message);
      if (outcome.ok) {
        firstId ??= outcome.messageId;
        continue;
      }
      lastCode = outcome.code;
      if (outcome.code === 'UNREGISTERED') await this.tokens.retireDeviceToken(token);
    }
    if (firstId === undefined) throw new ChannelAdapterError(lastCode, 'FCM refused every token');
    return { providerMessageId: firstId };
  }

  private async accessToken(): Promise<string> {
    try {
      const { token } = await this.jwt.getAccessToken();
      if (token) return token;
    } catch (err) {
      this.logger.warn(
        `FCM access token request failed: ${err instanceof Error ? err.name : 'error'}`,
      );
    }
    throw new ChannelAdapterError('FCM_AUTH', 'no FCM access token');
  }

  private async sendOne(
    accessToken: string,
    token: string,
    message: ChannelMessage,
  ): Promise<{ ok: true; messageId: string } | { ok: false; code: AdapterErrorCode }> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        // A hung request must end inside the activity's 1 minute limit, or the attempt leaves no row.
        signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          message: {
            token,
            notification: { title: message.subject, body: message.body },
            data: message.data,
          },
        }),
      });
    } catch {
      return { ok: false, code: 'FCM_UNREACHABLE' };
    }
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) {
      const parsed = fcmSuccessSchema.safeParse(payload);
      return parsed.success
        ? { ok: true, messageId: parsed.data.name }
        : { ok: false, code: 'FCM_BAD_RESPONSE' };
    }
    return { ok: false, code: fcmErrorCode(response.status, payload) };
  }
}

function isFcmCode(code: string | undefined): code is FcmErrorCode {
  return code !== undefined && Object.hasOwn(FCM_ERROR_KINDS, code);
}

/** FCM's own code, else the request status, else a bucket by HTTP status. */
function fcmErrorCode(httpStatus: number, payload: unknown): AdapterErrorCode {
  const parsed = fcmErrorSchema.safeParse(payload);
  if (parsed.success) {
    const fcmCode = parsed.data.error.details?.find((d) => d.errorCode)?.errorCode;
    if (isFcmCode(fcmCode)) return fcmCode;
    if (isFcmCode(parsed.data.error.status)) return parsed.data.error.status;
  }
  return httpStatus >= 500 || httpStatus === 429 ? 'FCM_SERVER_ERROR' : 'FCM_REJECTED';
}
