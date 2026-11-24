import { createTransport, type Transporter } from 'nodemailer';
import { type AdapterErrorCode, SMTP_ERROR_KINDS, type SmtpErrorCode } from './adapter-errors';
import {
  type ChannelAdapter,
  ChannelAdapterError,
  type ChannelMessage,
  type ChannelSendResult,
} from './channel-adapter';

export interface SmtpLimits {
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  /** Idle time on an open connection. */
  socketTimeoutMs: number;
  /** Cap on one whole send; the socket timeouts alone do not stop a server that trickles. */
  sendDeadlineMs: number;
}

// Well under the 1 minute activity timeout, and short enough not to hold a NATS handler on the
// inline (secret) path, so every attempt ends with its own delivery row.
export const SMTP_LIMITS: SmtpLimits = {
  connectionTimeoutMs: 10_000,
  greetingTimeoutMs: 10_000,
  socketTimeoutMs: 20_000,
  sendDeadlineMs: 30_000,
};

/** Email over SMTP, configured by `SMTP_URL` (e.g. smtp://user:pass@host:587) and `EMAIL_FROM`. */
export class SmtpEmailAdapter implements ChannelAdapter {
  readonly channel = 'EMAIL';
  readonly provider = 'smtp';
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
    private readonly limits: SmtpLimits = SMTP_LIMITS,
  ) {
    this.transporter = createTransport({
      url: smtpUrl,
      connectionTimeout: limits.connectionTimeoutMs,
      greetingTimeout: limits.greetingTimeoutMs,
      socketTimeout: limits.socketTimeoutMs,
    });
  }

  async send(message: ChannelMessage): Promise<ChannelSendResult> {
    const [to] = message.to;
    if (!to) throw new ChannelAdapterError('NO_RECIPIENT', 'email message has no address');
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject: message.subject,
        text: message.body,
        signal: AbortSignal.timeout(this.limits.sendDeadlineMs),
      });
      return { providerMessageId: info.messageId };
    } catch (err) {
      throw new ChannelAdapterError(smtpErrorCode(err), 'SMTP send failed');
    }
  }

  close(): void {
    this.transporter.close();
  }
}

function isSmtpCode(code: string): code is SmtpErrorCode {
  return Object.hasOwn(SMTP_ERROR_KINDS, code);
}

/**
 * Nodemailer's own code (ECONNECTION, EAUTH, ETIMEDOUT, EABORT for the send deadline, ...) plus
 * the SMTP reply code.
 */
function smtpErrorCode(err: unknown): AdapterErrorCode {
  if (typeof err !== 'object' || err === null) return 'SMTP_ERROR';
  const code: SmtpErrorCode =
    'code' in err && typeof err.code === 'string' && isSmtpCode(err.code) ? err.code : 'SMTP_ERROR';
  const reply =
    'responseCode' in err && typeof err.responseCode === 'number' ? err.responseCode : null;
  return reply ? `${code}_${reply}` : code;
}
