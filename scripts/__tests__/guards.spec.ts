// scripts/__tests__/guards.spec.ts
import { describe, expect, it } from 'vitest';
import { assertSafeToRunDestructiveSeed } from '../guards';

describe('assertSafeToRunDestructiveSeed', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const restoreEnv = () => {
    process.env.NODE_ENV = originalNodeEnv;
  };

  it('does not throw when NODE_ENV is undefined', () => {
    delete process.env.NODE_ENV;
    expect(() => assertSafeToRunDestructiveSeed()).not.toThrow();
    restoreEnv();
  });

  it('does not throw when NODE_ENV is "development"', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertSafeToRunDestructiveSeed()).not.toThrow();
    restoreEnv();
  });

  it('does not throw when NODE_ENV is "test"', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertSafeToRunDestructiveSeed()).not.toThrow();
    restoreEnv();
  });

  it('throws when NODE_ENV is "production"', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertSafeToRunDestructiveSeed()).toThrow(/production/i);
    restoreEnv();
  });
});
