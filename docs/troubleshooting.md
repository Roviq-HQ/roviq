# Troubleshooting

Where to look when the dev or e2e environment misbehaves. One entry per symptom.

| Symptom | Go to |
|---------|-------|
| The running dev app contradicts the code or a passing test | `docs/infrastructure.md` → "When the dev app looks wrong" |
| A port is taken, or a command reaches another checkout's Tilt | `docs/infrastructure.md` → "Parallel dev instances" |
| The e2e stack does not start, or its gateway keeps restarting | [The e2e gateway container is in a restart loop](#the-e2e-gateway-container-is-in-a-restart-loop) |
| A test suite is slow, flaky or rebuilds for no reason | [changelogs/testing-troubleshooting.md](changelogs/testing-troubleshooting.md): search for the symptom |
| A dependency update fails | [dependency-updates.md](dependency-updates.md) → "Failure modes and how to debug them" |

After fixing a testing-infrastructure problem, append an entry to the changelog. A new dev
environment footgun gets an entry on this page.

## The e2e gateway container is in a restart loop

**Symptom.** `pnpm e2e:up` does not become healthy, or `docker ps -a` shows the e2e API gateway
container (`roviq-e2e-api-gateway-1` in slot 0) restarting or exited.

**Cause.** The container builds the backend itself with the host's `node_modules` and source, so
it fails when:

- a dependency was added but `pnpm install` has not been run on the host, or
- the checked-out source has a TypeScript error.

**Diagnose.**

```bash
docker ps -a | grep -i restart
docker inspect roviq-e2e-api-gateway-1 --format '{{.RestartCount}} {{.State.Status}}'
docker logs --tail 40 roviq-e2e-api-gateway-1
```

`Cannot find module '<name>'` means `pnpm install`; a compile error means fix the source.

**Fix.**

```bash
pnpm e2e:down    # stops the containers, keeps volumes and .e2e/ (fast next start)
pnpm e2e:up      # starts against the current checkout and node_modules
```

`pnpm e2e:nuke` also removes the volumes and `.e2e/`; the next `e2e:up` then pays a full rebuild.

**Why `docker/compose.e2e.yaml` is built the way it is.** On 2026-04-17 a failing e2e gateway
restarted 636 times, and each restart deleted the host's `dist/apps/api-gateway/` through a shared
bind mount, which crashed the dev gateway. The deletion happened inside the container, so no host
process showed it. Three settings prevent a repeat; do not revert them:

- The backend containers mount `.e2e/dist` over `dist/` and `.e2e/nx` over `.nx/`, so a container
  never writes the host's build output or Nx state.
- `api-gateway` and `notification-service` use `restart: on-failure:3`, not `unless-stopped`.
- `e2e:down` has no `-v`, so a normal teardown keeps the build cache.

The dev apps now run from source and do not read `dist/`
(`docs/infrastructure.md` → "How the backend apps run in dev").
