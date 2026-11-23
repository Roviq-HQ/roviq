/** What `/api/alerts` returns to the browser: only the fields the alerts banner shows. */
export interface ObservabilityAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing';
  activeAt: string;
}

export interface ObservabilityAlertsResponse {
  status: 'success';
  data: { alerts: ObservabilityAlert[] };
}

export interface OpenObserveAlertSummary {
  alertId: string;
  enabled: boolean;
  lastOutcome: string | null;
  lastOutcomeSinceUs: number | null;
}

export interface OpenObserveAlertDetail {
  name: string;
  description: string;
  contextAttributes: Record<string, string>;
}

/** Maps one OpenObserve alert to the banner model; owner, query and destinations never leave the server. */
export function toObservabilityAlert(
  summary: OpenObserveAlertSummary,
  detail: OpenObserveAlertDetail,
  nowMs: number,
): ObservabilityAlert {
  const activeAtMs =
    summary.lastOutcomeSinceUs === null ? nowMs : Math.floor(summary.lastOutcomeSinceUs / 1000);
  return {
    labels: { ...detail.contextAttributes, alertname: detail.name },
    annotations: detail.description ? { summary: detail.description } : {},
    state: 'firing',
    activeAt: new Date(activeAtMs).toISOString(),
  };
}

export function isFiring(summary: OpenObserveAlertSummary): boolean {
  return summary.enabled && summary.lastOutcome === 'firing';
}

/** Validates `GET /api/v2/{org}/alerts`; null when the shape is not the expected one. */
export function parseAlertList(json: unknown): OpenObserveAlertSummary[] | null {
  if (!isRecord(json) || !Array.isArray(json.list)) return null;
  const out: OpenObserveAlertSummary[] = [];
  for (const item of json.list) {
    if (!isRecord(item) || typeof item.alert_id !== 'string' || typeof item.enabled !== 'boolean') {
      return null;
    }
    out.push({
      alertId: item.alert_id,
      enabled: item.enabled,
      lastOutcome: typeof item.last_outcome === 'string' ? item.last_outcome : null,
      lastOutcomeSinceUs:
        typeof item.last_outcome_since === 'number' && Number.isFinite(item.last_outcome_since)
          ? item.last_outcome_since
          : null,
    });
  }
  return out;
}

/** Validates `GET /api/v2/{org}/alerts/{id}`; null when the shape is not the expected one. */
export function parseAlertDetail(json: unknown): OpenObserveAlertDetail | null {
  if (!isRecord(json) || typeof json.name !== 'string') return null;
  const contextAttributes: Record<string, string> = {};
  if (isRecord(json.context_attributes)) {
    for (const [key, value] of Object.entries(json.context_attributes)) {
      if (typeof value === 'string') contextAttributes[key] = value;
    }
  }
  return {
    name: json.name,
    description: typeof json.description === 'string' ? json.description : '',
    contextAttributes,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
