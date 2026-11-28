/** What the API answers for firing alerts: only the fields the alerts banner shows. */
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
