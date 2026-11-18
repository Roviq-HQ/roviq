import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const REQUEST_TIMEOUT_MS = 3_000;

/** Instant-vector sample. */
export interface PromSample {
  metric: Record<string, string>;
  value: number;
}

/** Range-matrix series; each point is `[unixSeconds, value]`. */
export interface PromSeries {
  metric: Record<string, string>;
  values: Array<[number, number]>;
}

export interface PromAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive';
  activeAt: string;
}

/** Prometheus unreachable, timed out, or answered with a non-success status. Callers degrade to "metrics unavailable". */
export class PrometheusUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PrometheusUnavailableError';
  }
}

type RawSampleValue = [number, string];

interface PromEnvelope<T> {
  status: 'success' | 'error';
  data?: T;
  error?: string;
}

interface VectorData {
  resultType: 'vector';
  result: Array<{ metric: Record<string, string>; value: RawSampleValue }>;
}

interface MatrixData {
  resultType: 'matrix';
  result: Array<{ metric: Record<string, string>; values: RawSampleValue[] }>;
}

interface AlertsData {
  alerts: PromAlert[];
}

@Injectable()
export class PrometheusClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl =
      config.get<string>('PROMETHEUS_URL') ??
      `http://localhost:${config.get<string>('DEV_PROMETHEUS_PORT') ?? '9090'}`;
  }

  async query(promql: string): Promise<PromSample[]> {
    const data = await this.get<VectorData>('query', { query: promql });
    if (data.resultType !== 'vector') {
      throw new PrometheusUnavailableError(`Expected vector result, got ${data.resultType}`);
    }
    return data.result.map((r) => ({ metric: r.metric, value: Number(r.value[1]) }));
  }

  async queryRange(
    promql: string,
    startSec: number,
    endSec: number,
    stepSec: number,
  ): Promise<PromSeries[]> {
    const data = await this.get<MatrixData>('query_range', {
      query: promql,
      start: String(startSec),
      end: String(endSec),
      step: String(stepSec),
    });
    if (data.resultType !== 'matrix') {
      throw new PrometheusUnavailableError(`Expected matrix result, got ${data.resultType}`);
    }
    return data.result.map((r) => ({
      metric: r.metric,
      values: r.values.map(([ts, v]): [number, number] => [ts, Number(v)]),
    }));
  }

  async alerts(): Promise<PromAlert[]> {
    const data = await this.get<AlertsData>('alerts', {});
    return data.alerts;
  }

  private async get<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1/${endpoint}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (cause) {
      throw new PrometheusUnavailableError(`Prometheus ${endpoint} request failed`, { cause });
    }
    if (!res.ok) {
      throw new PrometheusUnavailableError(`Prometheus ${endpoint} returned HTTP ${res.status}`);
    }
    let body: PromEnvelope<T>;
    try {
      body = (await res.json()) as PromEnvelope<T>;
    } catch (cause) {
      throw new PrometheusUnavailableError(`Prometheus ${endpoint} returned invalid JSON`, {
        cause,
      });
    }
    if (body.status !== 'success' || body.data === undefined) {
      throw new PrometheusUnavailableError(
        `Prometheus ${endpoint} error: ${body.error ?? 'unknown'}`,
      );
    }
    return body.data;
  }
}
