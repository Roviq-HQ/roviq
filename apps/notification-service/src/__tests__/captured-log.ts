import { Writable } from 'node:stream';
import { ConsoleLogger, Logger as NestLogger } from '@nestjs/common';
import { createListedLogger, requestLoggerParams } from '@roviq/telemetry';
import { Logger, PinoLogger } from 'nestjs-pino';

export interface CapturedLog {
  /** Every line written since the capture began, as the service's logger writes it. */
  readonly lines: string[];
  stop(): void;
}

/**
 * Routes every `new Logger(...)` of the code under test through the listed logger the service
 * runs with (as `app.useLogger` does in `main.ts`) and collects the lines.
 */
export function captureLog(): CapturedLog {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const params = requestLoggerParams(createListedLogger({ level: 'trace' }, stream), false);
  NestLogger.overrideLogger(new Logger(new PinoLogger(params), params));
  return { lines, stop: () => NestLogger.overrideLogger(new ConsoleLogger()) };
}
