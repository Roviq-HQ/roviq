import { NextResponse } from 'next/server';
import { requireAdminAuth } from '../_lib/admin-auth';
import {
  isFiring,
  type ObservabilityAlert,
  type ObservabilityAlertsResponse,
  parseAlertDetail,
  parseAlertList,
  toObservabilityAlert,
} from '../_lib/alert-model';
import { openObserveRequest } from '../_lib/openobserve';

export async function GET(request: Request) {
  const denied = requireAdminAuth(request);
  if (denied) return denied;

  const listResult = await openObserveRequest({ path: (org) => `/api/v2/${org}/alerts` });
  if (!listResult.ok) return listResult.response;
  const list = listResult.status === 200 ? parseAlertList(parseJson(listResult.body)) : null;
  if (!list) return badUpstream('alert list', listResult.status);

  const firing = list.filter(isFiring);
  const details = await Promise.all(
    firing.map((summary) =>
      openObserveRequest({
        path: (org) => `/api/v2/${org}/alerts/${encodeURIComponent(summary.alertId)}`,
      }),
    ),
  );

  const nowMs = Date.now();
  const alerts: ObservabilityAlert[] = [];
  for (const [i, result] of details.entries()) {
    if (!result.ok) return result.response;
    const detail = result.status === 200 ? parseAlertDetail(parseJson(result.body)) : null;
    if (!detail) return badUpstream('alert detail', result.status);
    alerts.push(toObservabilityAlert(firing[i], detail, nowMs));
  }

  const body: ObservabilityAlertsResponse = { status: 'success', data: { alerts } };
  return NextResponse.json(body);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function badUpstream(what: string, status: number): NextResponse {
  return NextResponse.json(
    { error: 'openobserve error', detail: `unexpected ${what} response (HTTP ${status})` },
    { status: 502 },
  );
}
