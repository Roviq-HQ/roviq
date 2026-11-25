import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ROOT = path.resolve(__dirname, '../..');
const ALERTS_DIR = path.join(ROOT, 'docker/openobserve/alerts');

const alertSchema = z.object({
  name: z.string().regex(/^notification_[a-z_]+$/),
  description: z.string().min(1),
  stream_type: z.literal('metrics'),
  stream_name: z.string().regex(/^[a-z_]+$/),
  is_real_time: z.literal(false),
  enabled: z.literal(true),
  query_condition: z.object({
    type: z.literal('promql'),
    promql: z.string().min(1),
    promql_condition: z.object({
      column: z.literal('value'),
      operator: z.enum(['>', '<', '>=', '<=']),
      value: z.number(),
    }),
  }),
  trigger_condition: z.object({
    period: z.number().int().positive(),
    operator: z.literal('>='),
    threshold: z.literal(1),
    frequency: z.number().int().positive(),
    frequency_type: z.literal('minutes'),
    silence: z.number().int().positive(),
  }),
  pending_period_sec: z.number().int().nonnegative(),
  destinations: z.tuple([z.literal('roviq_ops_email')]),
  context_attributes: z.object({
    severity: z.enum(['page', 'ticket']),
    component: z.literal('notifications'),
    runbook: z.string().regex(/^docs\/[a-z/-]+\.md#[a-z0-9-]+$/),
  }),
});

const files = readdirSync(ALERTS_DIR).filter((f) => f.startsWith('notification_'));

/** The anchors GitHub gives a document's headings. */
function anchorsOf(markdown: string): Set<string> {
  return new Set(
    [...markdown.matchAll(/^#{1,6} (.+)$/gm)].map((m) =>
      (m[1] ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, '')
        .replace(/ /g, '-'),
    ),
  );
}

describe('notification alert files', () => {
  it('should hold the eight notification alerts', () => {
    expect(files.sort()).toEqual([
      'notification_breaker_opened.json',
      'notification_canary_missing.json',
      'notification_dead_letters.json',
      'notification_events_stuck.json',
      'notification_failure_rate.json',
      'notification_sender_blocked.json',
      'notification_service_down.json',
      'notification_skips_rising.json',
    ]);
  });

  it.each(
    files,
  )('%s should parse, be named after its file and point at a runbook section', (file) => {
    const alert = alertSchema.parse(JSON.parse(readFileSync(path.join(ALERTS_DIR, file), 'utf8')));

    expect(`${alert.name}.json`).toBe(file);
    const [doc, anchor] = alert.context_attributes.runbook.split('#');
    expect(doc).toBeDefined();
    expect(anchor).toBeDefined();
    const markdown = readFileSync(path.join(ROOT, doc ?? ''), 'utf8');
    expect(anchorsOf(markdown)).toContain(anchor);
  });

  it.each(files)('%s should query only the series its stream names', (file) => {
    const alert = alertSchema.parse(JSON.parse(readFileSync(path.join(ALERTS_DIR, file), 'utf8')));

    expect(alert.query_condition.promql).toContain(alert.stream_name);
  });

  // A counter's series starts again at 1 with each process, and a series born at 1 has no
  // increase: a rule on one event built that way misses the first event after a restart.
  const singleEvent = files.filter((file) => {
    const { promql_condition: c } = alertSchema.parse(
      JSON.parse(readFileSync(path.join(ALERTS_DIR, file), 'utf8')),
    ).query_condition;
    return c.operator === '>' && c.value === 0;
  });

  it('should have rules that fire on one event', () => {
    expect(singleEvent.sort()).toEqual([
      'notification_breaker_opened.json',
      'notification_dead_letters.json',
      'notification_sender_blocked.json',
      'notification_skips_rising.json',
    ]);
  });

  it.each(singleEvent)('%s should read a gauge, not increase() or rate() of a counter', (file) => {
    const alert = alertSchema.parse(JSON.parse(readFileSync(path.join(ALERTS_DIR, file), 'utf8')));

    expect(alert.query_condition.promql).not.toMatch(/\b(increase|rate|irate|delta)\(/);
  });
});
