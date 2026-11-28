import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 3_000;
// A search reads a time range of a stream; the pages that show it poll, they do not block.
const SEARCH_TIMEOUT_MS = 8_000;
const MICROS_PER_MS = 1_000;

/** Instant-vector sample. */
export interface MetricSample {
  metric: Record<string, string>;
  value: number;
}

/** Range-matrix series; each point is `[unixSeconds, value]`. */
export interface MetricSeries {
  metric: Record<string, string>;
  values: Array<[number, number]>;
}

/** A rule's PromQL query and the comparison each result row must pass for the rule to fire. */
export interface AlertCondition {
  promql: string;
  operator: '>' | '<' | '>=' | '<=';
  value: number;
}

export interface FiringAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive';
  activeAt: string;
  /** null for a rule that is not PromQL. */
  condition: AlertCondition | null;
}

/** OpenObserve unconfigured, unreachable, timed out, or answered with a non-success status. Callers degrade to "metrics unavailable". */
export class OpenObserveUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OpenObserveUnavailableError';
  }
}

const envelopeSchema = z.object({
  status: z.string(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

const labelsSchema = z.record(z.string(), z.string());
const rawSampleSchema = z.tuple([z.number(), z.string()]);

const vectorSchema = z.object({
  resultType: z.literal('vector'),
  result: z.array(z.object({ metric: labelsSchema, value: rawSampleSchema })),
});

const matrixSchema = z.object({
  resultType: z.literal('matrix'),
  result: z.array(z.object({ metric: labelsSchema, values: z.array(rawSampleSchema) })),
});

const alertListSchema = z.object({
  list: z.array(
    z.object({
      alert_id: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      last_outcome: z.string().nullish(),
      last_outcome_since: z.number().nullish(),
    }),
  ),
});

const alertDetailSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  context_attributes: labelsSchema.nullish(),
  query_condition: z
    .object({
      type: z.string().nullish(),
      promql: z.string().nullish(),
      promql_condition: z
        .object({ operator: z.enum(['>', '<', '>=', '<=']), value: z.number() })
        .nullish(),
    })
    .nullish(),
});

/** Reads metrics and alerts from OpenObserve (metrics through its PromQL-compatible API). */
@Injectable()
export class OpenObserveClient {
  private readonly baseUrl: string;
  private readonly org: string;
  private readonly authorization: string | null;

  constructor(config: ConfigService) {
    this.baseUrl =
      config.get<string>('OPENOBSERVE_URL') ??
      `http://localhost:${config.get<string>('DEV_OPENOBSERVE_PORT') ?? '5080'}`;
    this.org = encodeURIComponent(config.get<string>('OPENOBSERVE_ORG') ?? 'default');
    const user = config.get<string>('OPENOBSERVE_USER');
    const password = config.get<string>('OPENOBSERVE_PASSWORD');
    this.authorization =
      user && password ? `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` : null;
  }

  async query(promql: string): Promise<MetricSample[]> {
    const data = parse(vectorSchema, await this.promql('query', { query: promql }), 'query');
    return data.result.map((r) => ({ metric: r.metric, value: Number(r.value[1]) }));
  }

  async queryRange(
    promql: string,
    startSec: number,
    endSec: number,
    stepSec: number,
  ): Promise<MetricSeries[]> {
    const raw = await this.promql('query_range', {
      query: promql,
      start: String(startSec),
      end: String(endSec),
      step: String(stepSec),
    });
    const data = parse(matrixSchema, raw, 'query_range');
    return data.result.map((r) => ({
      metric: r.metric,
      values: r.values.map(([ts, v]): [number, number] => [ts, Number(v)]),
    }));
  }

  /**
   * One PromQL call, answered as the store sent it: the Prometheus envelope, also when its
   * status is `error` (a query the store refuses is the caller's to show).
   */
  prometheus(endpoint: 'query' | 'query_range', params: Record<string, string>): Promise<unknown> {
    return this.fetchJson(endpoint, `/api/${this.org}/prometheus/api/v1/${endpoint}`, params, {
      acceptClientError: true,
    });
  }

  /** One SQL search on the logs or traces stream. `sql` is built from validated input only. */
  search(args: {
    type: 'logs' | 'traces';
    sql: string;
    sinceSeconds: number;
    size: number;
  }): Promise<unknown> {
    const endUs = Date.now() * MICROS_PER_MS;
    return this.fetchJson(
      `${args.type} search`,
      `/api/${this.org}/_search`,
      { type: args.type },
      {
        json: {
          query: {
            sql: args.sql,
            start_time: endUs - args.sinceSeconds * 1_000_000,
            end_time: endUs,
            from: 0,
            size: args.size,
          },
        },
        timeoutMs: SEARCH_TIMEOUT_MS,
      },
    );
  }

  /** Enabled alerts whose last evaluation fired; one failed detail read fails the whole call. */
  async alerts(): Promise<FiringAlert[]> {
    const list = parse(
      alertListSchema,
      await this.fetchJson('alerts', `/api/v2/${this.org}/alerts`),
      'alerts',
    );
    const firing = list.list.filter((a) => a.enabled && a.last_outcome === 'firing');
    return Promise.all(
      firing.map(async (alert): Promise<FiringAlert> => {
        const raw = await this.fetchJson(
          'alert detail',
          `/api/v2/${this.org}/alerts/${encodeURIComponent(alert.alert_id)}`,
        );
        const detail = parse(alertDetailSchema, raw, 'alert detail');
        const since = alert.last_outcome_since;
        const q = detail.query_condition;
        return {
          condition:
            q?.type === 'promql' && q.promql && q.promql_condition
              ? { promql: q.promql, ...q.promql_condition }
              : null,
          labels: { alertname: detail.name, ...detail.context_attributes },
          annotations: detail.description ? { summary: detail.description } : {},
          state: 'firing',
          activeAt: new Date(since == null ? Date.now() : since / MICROS_PER_MS).toISOString(),
        };
      }),
    );
  }

  private async promql(endpoint: string, params: Record<string, string>): Promise<unknown> {
    const raw = await this.fetchJson(
      endpoint,
      `/api/${this.org}/prometheus/api/v1/${endpoint}`,
      params,
    );
    const body = envelopeSchema.safeParse(raw);
    if (!body.success || body.data.status !== 'success' || body.data.data === undefined) {
      throw new OpenObserveUnavailableError(
        `OpenObserve ${endpoint} error: ${body.data?.error ?? 'unknown'}`,
      );
    }
    return body.data.data;
  }

  private async fetchJson(
    label: string,
    path: string,
    params: Record<string, string> = {},
    options: { json?: unknown; timeoutMs?: number; acceptClientError?: boolean } = {},
  ): Promise<unknown> {
    if (!this.authorization) {
      throw new OpenObserveUnavailableError('OpenObserve credentials are not configured');
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let res: Response;
    try {
      res = await fetch(url, {
        method: options.json === undefined ? 'GET' : 'POST',
        headers: {
          authorization: this.authorization,
          ...(options.json === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.json === undefined ? undefined : JSON.stringify(options.json),
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new OpenObserveUnavailableError(`OpenObserve ${label} request failed`, { cause });
    }
    const clientError = res.status >= 400 && res.status < 500;
    if (!res.ok && !(options.acceptClientError && clientError)) {
      throw new OpenObserveUnavailableError(`OpenObserve ${label} returned HTTP ${res.status}`);
    }
    try {
      return await res.json();
    } catch (cause) {
      throw new OpenObserveUnavailableError(`OpenObserve ${label} returned invalid JSON`, {
        cause,
      });
    }
  }
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new OpenObserveUnavailableError(`OpenObserve ${label} has an unexpected shape`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
