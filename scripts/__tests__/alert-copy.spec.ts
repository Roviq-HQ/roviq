import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALERT_TARGET,
  runbookUrl,
} from '../../apps/web/src/app/[locale]/admin/(dashboard)/monitoring/_lib/alert-guide';

const ROOT = path.resolve(__dirname, '../..');
const RULES = readdirSync(path.join(ROOT, 'docker/openobserve/alerts'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

type RuleCopy = Record<string, string>;

function rulesCopy(locale: 'en' | 'hi'): Record<string, RuleCopy> {
  const messages = JSON.parse(
    readFileSync(path.join(ROOT, `apps/web/messages/${locale}/adminMonitoring.json`), 'utf8'),
  );
  return messages.alerts.rules;
}

describe('alert copy', () => {
  it('should find the rule files', () => {
    expect(RULES.length).toBeGreaterThan(0);
  });

  it.each([
    'en',
    'hi',
  ] as const)('should give every rule a title, an impact and a first step in %s', (locale) => {
    const copy = rulesCopy(locale);

    for (const rule of RULES) {
      expect(copy[rule]?.title, `${rule} title`).toBeTruthy();
      expect(copy[rule]?.impact, `${rule} impact`).toBeTruthy();
      expect(copy[rule]?.step1, `${rule} step1`).toBeTruthy();
    }
    expect(Object.keys(copy).sort()).toEqual(RULES);
  });

  it('should give the same steps in both languages', () => {
    const en = rulesCopy('en');
    const hi = rulesCopy('hi');

    for (const rule of RULES) {
      expect(Object.keys(hi[rule] ?? {}).sort(), rule).toEqual(Object.keys(en[rule] ?? {}).sort());
    }
  });

  it('should name the screen the first step needs for every rule', () => {
    expect(Object.keys(ALERT_TARGET).sort()).toEqual(RULES);
  });

  it("should link every rule's runbook section", () => {
    for (const rule of RULES) {
      const file = JSON.parse(
        readFileSync(path.join(ROOT, `docker/openobserve/alerts/${rule}.json`), 'utf8'),
      );
      expect(runbookUrl(file.context_attributes?.runbook), rule).toMatch(
        /^https:\/\/github\.com\/Roviq-HQ\/roviq\/blob\/main\/docs\/runbooks\//,
      );
    }
  });

  it('should refuse a runbook label that is not a repository docs path', () => {
    expect(runbookUrl('https://evil.example/x')).toBeNull();
    expect(runbookUrl('../secrets.md')).toBeNull();
    expect(runbookUrl(null)).toBeNull();
  });
});
