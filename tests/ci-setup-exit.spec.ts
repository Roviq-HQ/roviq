import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../scripts/ci-check.sh', import.meta.url), 'utf8');
const helper = source.match(/ {2}wait_setup_service\(\) \{[\s\S]*?\n {2}\}/)?.[0];
assert(helper, 'ci-check must define the setup completion check');

function checkSetup({ exitCode = 0, dockerStatus = 0, missing = false } = {}) {
  return spawnSync(
    'bash',
    [
      '-c',
      `
    set -e
    log() { printf '%s\\n' "$*" >&2; }
    compose_stub() {
      case "$*" in
        'ps --all --quiet setup') printf '%s' '${missing ? '' : 'already-exited-container'}' ;;
        'logs --no-color setup') printf 'setup logs\\n' >&2 ;;
        *) return 99 ;;
      esac
    }
    docker() {
      [[ "$*" == 'wait already-exited-container' ]] || return 99
      if (( ${dockerStatus} != 0 )); then return ${dockerStatus}; fi
      printf '%s\\n' '${exitCode}'
    }
    COMPOSE=(compose_stub)
    ${helper}
    wait_setup_service setup
  `,
    ],
    { encoding: 'utf8' },
  );
}

describe('CI setup container completion', () => {
  it('should accept a setup container that has already exited successfully', () => {
    const result = checkSetup();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('should propagate setup failure and print its logs', () => {
    const result = checkSetup({ exitCode: 7 });

    expect(result.status).toBe(7);
    expect(result.stderr).toBe('setup logs\n');
  });

  it('should propagate a Docker wait error', () => {
    expect(checkSetup({ dockerStatus: 42 }).status).toBe(42);
  });

  it('should reject a missing setup container', () => {
    const result = checkSetup({ missing: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('ERROR: no container found for setup service setup\n');
  });
});
