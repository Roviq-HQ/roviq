import { ConfigService } from '@nestjs/config';

const REQUEST_TIMEOUT_MS = 10_000;

export type AccountCheck = 'ok' | 'refused' | 'unreachable';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The one provider call the gateway makes (ROV-333): whether a token may manage the templates
 * of an account, asked with the token just given, before it is stored. Everything else about
 * templates happens in the notification service. Logs nothing: the request holds the token.
 */
export class WhatsAppAccountCheck {
  private readonly baseUrl: string | null;

  constructor(
    config: ConfigService,
    private readonly request: typeof fetch = fetch,
  ) {
    this.baseUrl = config.get<string>('WHATSAPP_API_BASE_URL')?.replace(/\/+$/, '') ?? null;
  }

  async canManageTemplates(providerAccountId: string, accessToken: string): Promise<AccountCheck> {
    if (this.baseUrl === null) return 'unreachable';
    let response: Response;
    try {
      response = await this.request(
        `${this.baseUrl}/${encodeURIComponent(providerAccountId)}/message_templates?fields=id&limit=1`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      return 'unreachable';
    }
    if (response.ok) return 'ok';
    if (response.status >= 500 || response.status === 429) return 'unreachable';
    // A token of another account, an unknown account and a missing permission all answer 4xx.
    const body: unknown = await response.json().catch(() => null);
    return isRecord(body) && isRecord(body.error) ? 'refused' : 'unreachable';
  }
}
