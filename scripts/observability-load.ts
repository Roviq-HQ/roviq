/**
 * Loads the dashboards and alerts in docker/openobserve/ into OpenObserve through its API.
 * Safe to re-run: an object that already matches its file is left alone. Run by Tilt's
 * `observability` resource in dev and by the deploy step in production (docs/deployment.md).
 *
 * Usage: pnpm observability:load
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { alertRecipients, type Json, type LoadAction, planLoad } from './lib/observability';

const FILES_DIR = path.resolve(__dirname, '../docker/openobserve');
const DESTINATION = 'roviq_ops_email';
const FOLDER = 'default';
const READY_TIMEOUT_MS = 60_000;

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`${name} is not set. Copy it from .env.example into .env.`);
    process.exit(1);
  }
  return value;
}

const baseUrl = (
  process.env.OPENOBSERVE_URL ?? `http://localhost:${process.env.DEV_OPENOBSERVE_PORT ?? '5080'}`
).replace(/\/+$/, '');
const org = process.env.OPENOBSERVE_ORG ?? 'default';
const user = required('OPENOBSERVE_USER', process.env.OPENOBSERVE_USER);
const password = required('OPENOBSERVE_PASSWORD', process.env.OPENOBSERVE_PASSWORD);
const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

type JsonObject = { [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(file: string): JsonObject {
  const parsed: Json = JSON.parse(readFileSync(file, 'utf8'));
  if (!isObject(parsed)) throw new Error(`${file} must hold a JSON object`);
  return parsed;
}

function readDir(dir: string): JsonObject[] {
  const full = path.join(FILES_DIR, dir);
  return readdirSync(full)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson(path.join(full, name)));
}

function text(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value;
}

interface ApiResponse {
  status: number;
  body: Json;
}

async function api(method: string, route: string, body?: Json): Promise<ApiResponse> {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await res.text();
  let parsed: Json = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Some endpoints answer with plain text; keep it for the error message.
  }
  return { status: res.status, body: parsed };
}

async function mustSucceed(method: string, route: string, body?: Json): Promise<Json> {
  const res = await api(method, route, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method} ${route} answered ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function getOrMissing(route: string): Promise<Json | undefined> {
  const res = await api('GET', route);
  if (res.status === 404) return undefined;
  if (res.status !== 200) {
    throw new Error(`GET ${route} answered ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function waitUntilReady(): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error(
        `OpenObserve at ${baseUrl} did not answer within ${READY_TIMEOUT_MS / 1000}s`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

const counts: Record<LoadAction, number> = { created: 0, updated: 0, unchanged: 0 };

function report(kind: string, name: string, action: LoadAction): void {
  counts[action] += 1;
  console.log(`${action.padEnd(9)} ${kind} ${name}`);
}

async function loadNamed(kind: string, collection: string, wanted: JsonObject): Promise<void> {
  const name = text(wanted, 'name');
  const stored = await getOrMissing(`${collection}/${encodeURIComponent(name)}`);
  const action = planLoad(wanted, stored);
  if (action === 'created') await mustSucceed('POST', collection, wanted);
  if (action === 'updated') {
    await mustSucceed('PUT', `${collection}/${encodeURIComponent(name)}`, wanted);
  }
  report(kind, name, action);
}

// An alert cannot be saved on a metric that has no data yet, and a counter has none until it is
// first incremented.
async function ensureMetricStream(stream: string): Promise<void> {
  const route = `/api/${org}/streams/${encodeURIComponent(stream)}`;
  const schema = await getOrMissing(`${route}/schema?type=metrics`);
  if (schema === undefined) {
    await mustSucceed('POST', `${route}?type=metrics`, { fields: [], settings: {} });
  }
}

async function loadAlerts(): Promise<void> {
  const listed = await mustSucceed('GET', `/api/v2/${org}/alerts?folder=${FOLDER}`);
  const list = isObject(listed) && Array.isArray(listed.list) ? listed.list : [];
  const idByName = new Map<string, string>();
  for (const item of list) {
    if (isObject(item) && typeof item.name === 'string' && typeof item.alert_id === 'string') {
      idByName.set(item.name, item.alert_id);
    }
  }

  for (const wanted of readDir('alerts')) {
    const name = text(wanted, 'name');
    await ensureMetricStream(text(wanted, 'stream_name'));
    const id = idByName.get(name);
    const stored = id ? await getOrMissing(`/api/v2/${org}/alerts/${id}`) : undefined;
    const action = planLoad(wanted, stored);
    if (action === 'created') {
      await mustSucceed('POST', `/api/v2/${org}/alerts?folder=${FOLDER}`, wanted);
    }
    if (action === 'updated') await mustSucceed('PUT', `/api/v2/${org}/alerts/${id}`, wanted);
    report('alert', name, action);
  }
}

async function loadDashboards(): Promise<void> {
  const listed = await mustSucceed('GET', `/api/${org}/dashboards?folder=${FOLDER}`);
  const list = isObject(listed) && Array.isArray(listed.dashboards) ? listed.dashboards : [];
  const storedByTitle = new Map<string, { id: string; hash: string; content: JsonObject }>();
  for (const item of list) {
    if (!isObject(item)) continue;
    const content = item.v5;
    if (!isObject(content)) continue;
    if (typeof content.title !== 'string' || typeof content.dashboardId !== 'string') continue;
    storedByTitle.set(content.title, {
      id: content.dashboardId,
      hash: typeof item.hash === 'string' ? item.hash : '',
      content,
    });
  }

  for (const wanted of readDir('dashboards')) {
    const title = text(wanted, 'title');
    const stored = storedByTitle.get(title);
    const action = planLoad(wanted, stored?.content);
    if (action === 'created') {
      await mustSucceed('POST', `/api/${org}/dashboards?folder=${FOLDER}`, wanted);
    }
    if (action === 'updated' && stored) {
      await mustSucceed(
        'PUT',
        `/api/${org}/dashboards/${stored.id}?folder=${FOLDER}&hash=${stored.hash}`,
        wanted,
      );
    }
    report('dashboard', title, action);
  }
}

async function main(): Promise<void> {
  await waitUntilReady();

  await loadDashboards();

  const template = readJson(path.join(FILES_DIR, 'alert-email-template.json'));
  await loadNamed('template', `/api/${org}/alerts/templates`, template);
  try {
    await loadNamed('destination', `/api/${org}/alerts/destinations`, {
      name: DESTINATION,
      type: 'email',
      emails: alertRecipients(process.env.OPENOBSERVE_ALERT_EMAILS, user),
      template: text(template, 'name'),
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('SMTP')) {
      throw new Error(
        'Alerts were not loaded: OpenObserve has no mail server, and an alert needs somewhere to go. ' +
          'Set the OPENOBSERVE_SMTP_* variables (docs/deployment.md → "Telemetry") and run this again.',
      );
    }
    throw err;
  }
  await loadAlerts();

  console.log(
    `OpenObserve at ${baseUrl}: ${counts.created} created, ${counts.updated} updated, ${counts.unchanged} unchanged`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
