import { describe, expect, it } from 'vitest';
import {
  composeProjectsForSlot,
  MAX_SLOT,
  PORT_VARS,
  portsForSlot,
  rewriteEnvForSlot,
  slotFromEnv,
} from '../lib/instance';

const BASE_ENV = [
  '# Dev database on localhost:5434',
  'DATABASE_URL=postgresql://roviq_pooler:roviq_pooler_dev@localhost:5434/roviq',
  'REDIS_URL=redis://localhost:6379',
  'ALLOWED_ORIGINS=http://localhost:4200,http://admin.localhost:4200,http://reseller.localhost:4200',
  'TEMPORAL_ADDRESS=localhost:7233',
  'JWT_SECRET=change-me',
  'API_GATEWAY_PORT=3005',
  'WEB_PORT=4200',
  'UNRELATED_URL=http://localhost:8080',
  '',
].join('\n');

describe('portsForSlot', () => {
  it('should return the default ports for slot 0', () => {
    const ports = portsForSlot(0);

    expect(ports.WEB_PORT).toBe(4200);
    expect(ports.API_GATEWAY_PORT).toBe(3005);
    expect(ports.DEV_POSTGRES_PORT).toBe(5434);
    expect(ports.E2E_API_PORT).toBe(3004);
    expect(ports.TILT_PORT).toBe(10350);
    expect(ports.API_GATEWAY_INSPECT_PORT).toBe(9229);
    expect(ports.NOTIFICATION_SERVICE_INSPECT_PORT).toBe(9230);
  });

  it('should shift every port by 20 per slot', () => {
    const ports = portsForSlot(2);

    expect(ports.WEB_PORT).toBe(4240);
    expect(ports.DEV_POSTGRES_PORT).toBe(5474);
    expect(ports.E2E_POSTGRES_PORT).toBe(5475);
    expect(ports.API_GATEWAY_INSPECT_PORT).toBe(9269);
  });

  it('should never give the same port to two services across all slots', () => {
    const all: number[] = [];
    for (let slot = 0; slot <= MAX_SLOT; slot++) {
      all.push(...Object.values(portsForSlot(slot)));
    }

    expect(new Set(all).size).toBe(PORT_VARS.length * (MAX_SLOT + 1));
  });

  it('should reject a slot outside the supported range', () => {
    expect(() => portsForSlot(MAX_SLOT + 1)).toThrow(
      'Instance slot must be an integer from 0 to 4',
    );
    expect(() => portsForSlot(-1)).toThrow('Instance slot must be an integer from 0 to 4');
    expect(() => portsForSlot(1.5)).toThrow('Instance slot must be an integer from 0 to 4');
  });
});

describe('composeProjectsForSlot', () => {
  it('should keep the existing project names for slot 0', () => {
    expect(composeProjectsForSlot(0)).toEqual({ dev: 'docker', e2e: 'roviq-e2e' });
  });

  it('should give other slots their own project names', () => {
    expect(composeProjectsForSlot(3)).toEqual({ dev: 'roviq-3', e2e: 'roviq-e2e-3' });
  });
});

describe('rewriteEnvForSlot', () => {
  it('should shift local URLs and port assignments to the slot', () => {
    const result = rewriteEnvForSlot(BASE_ENV, 1);

    expect(result).toContain(
      'DATABASE_URL=postgresql://roviq_pooler:roviq_pooler_dev@localhost:5454/roviq',
    );
    expect(result).toContain('REDIS_URL=redis://localhost:6399');
    expect(result).toContain(
      'ALLOWED_ORIGINS=http://localhost:4220,http://admin.localhost:4220,http://reseller.localhost:4220',
    );
    expect(result).toContain('TEMPORAL_ADDRESS=localhost:7253');
    expect(result).toContain('API_GATEWAY_PORT=3025');
    expect(result).toContain('WEB_PORT=4220');
  });

  it('should leave comments, secrets and unknown ports untouched', () => {
    const result = rewriteEnvForSlot(BASE_ENV, 1);

    expect(result).toContain('# Dev database on localhost:5434');
    expect(result).toContain('JWT_SECRET=change-me');
    expect(result).toContain('UNRELATED_URL=http://localhost:8080');
  });

  it('should append the instance block without repeating ports already assigned above', () => {
    const result = rewriteEnvForSlot(BASE_ENV, 1);

    expect(result).toContain('ROVIQ_INSTANCE=1');
    expect(result).toContain('ROVIQ_COMPOSE_PROJECT=roviq-1');
    expect(result).toContain('ROVIQ_E2E_COMPOSE_PROJECT=roviq-e2e-1');
    expect(result).toContain('DEV_POSTGRES_PORT=5454');
    expect(result).toContain('E2E_API_PORT=3024');
    expect(result).toContain('TILT_PORT=10370');
    expect(result.match(/^WEB_PORT=/gm)).toHaveLength(1);
    expect(result.match(/^API_GATEWAY_PORT=/gm)).toHaveLength(1);
  });

  it('should produce the same file when run twice for the same slot', () => {
    const once = rewriteEnvForSlot(BASE_ENV, 1);

    expect(rewriteEnvForSlot(once, 1)).toBe(once);
  });

  it('should move a file directly from one slot to another', () => {
    const viaSlotOne = rewriteEnvForSlot(rewriteEnvForSlot(BASE_ENV, 1), 3);

    expect(viaSlotOne).toBe(rewriteEnvForSlot(BASE_ENV, 3));
  });

  it('should restore the original file when moved back to slot 0', () => {
    const roundTrip = rewriteEnvForSlot(rewriteEnvForSlot(BASE_ENV, 2), 0);

    expect(roundTrip).toBe(BASE_ENV);
  });
});

describe('slotFromEnv', () => {
  it('should return 0 for a file with no instance block', () => {
    expect(slotFromEnv(BASE_ENV)).toBe(0);
  });

  it('should return the slot written by rewriteEnvForSlot', () => {
    expect(slotFromEnv(rewriteEnvForSlot(BASE_ENV, 4))).toBe(4);
  });
});
