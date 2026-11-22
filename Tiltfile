# Roviq Development Environment
# Infra runs in Docker, apps run locally for fast iteration
# Resources ordered so dev pipeline appears first in Tilt UI

load('ext://dotenv', 'dotenv')

# Auto-create .env from .env.example on first run
if not os.path.exists('.env'):
  local('cp .env.example .env', command_bat='copy .env.example .env')
  print('Created .env from .env.example')

# Load .env vars so all resources can access them
dotenv('./.env')

# Re-evaluate Tiltfile when .env changes
watch_file('.env')

# Parallel dev instances (docs/infrastructure.md): ports and the compose project come
# from .env, written by `pnpm instance:new`. Defaults are instance 0.
def port(name, default):
  return os.getenv(name, default)

def local_url(port_name, default, path=''):
  return 'http://localhost:%s%s' % (port(port_name, default), path)

def compose(path):
  project = os.getenv('ROVIQ_COMPOSE_PROJECT', '')
  if project:
    docker_compose(path, project_name=project)
  else:
    docker_compose(path)

# ─── Dev (startup pipeline + apps) ───────────────────────────────────────────

# Package manager — auto-runs on dependency changes
local_resource(
  'pnpm-install',
  cmd='pnpm install',
  deps=['package.json'],
  labels=['dev'],
)

# Schema push — auto-runs, retries until postgres is ready.
# A database with no tables is bootstrapped first (prereq functions, grants, custom migrations).
local_resource(
  'db-push',
  cmd='''
    for i in $(seq 1 30); do
      if pnpm run db:reset --if-empty 2>/dev/null && pnpm run db:push 2>/dev/null; then
        echo "Schema push completed successfully"
        exit 0
      fi
      echo "Waiting for PostgreSQL... (attempt $i/30)"
      sleep 2
    done
    echo "Schema push failed after 30 attempts"
    exit 1
  ''',
  deps=['libs/database/src/schema'],
  resource_deps=['pnpm-install', 'postgres'],
  labels=['dev'],
)

# Data migrations require an explicit manual trigger.
local_resource(
  'db-migrate',
  cmd='pnpm run db:migrate',
  resource_deps=['pnpm-install', 'postgres'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['dev'],
)

# Database seed — auto-runs after schema push, skips if already seeded
local_resource(
  'db-seed',
  cmd='pnpm run db:seed:demo',
  resource_deps=['db-push'],
  labels=['dev'],
)

# Object storage buckets — idempotent, re-runs when the script changes
local_resource(
  'storage-init',
  cmd='pnpm run storage:init',
  deps=['scripts/storage-init.ts'],
  resource_deps=['pnpm-install', 'object-storage'],
  labels=['dev'],
)

# API Gateway (NestJS) — core backend, all frontends depend on this
# Dev server watches apps/api-gateway/src and ee/apps/api-gateway/src via tsconfig
local_resource(
  'api-gateway',
  labels=['dev'],
  serve_cmd='pnpm run dev:gateway',
  serve_dir='.',
  deps=[],
  resource_deps=['db-push', 'redis', 'nats', 'storage-init'],
  readiness_probe=probe(
    http_get=http_get_action(port=int(port('API_GATEWAY_PORT', '3005')), path='/api/health/ready'),
    period_secs=10,
  ),
  links=[local_url('API_GATEWAY_PORT', '3005', '/api/graphql')],
)

# GraphQL Codegen — watches schema introspection + document files, regenerates types
# Uses @parcel/watcher for efficient file monitoring. Waits for API to be healthy first.
local_resource(
  'codegen',
  labels=['dev'],
  serve_cmd='pnpm codegen --watch',
  serve_dir='.',
  deps=[],
  resource_deps=['api-gateway'],
)

# Web (Next.js) — merged admin + institute portal
local_resource(
  'web',
  labels=['dev'],
  serve_cmd='pnpm run dev:web',
  serve_dir='.',
  deps=['.env'],
  resource_deps=['pnpm-install'],
  links=[local_url('WEB_PORT', '4200')],
)

# Notification Service (NestJS) — async event processing via NATS
local_resource(
  'notification-service',
  labels=['dev'],
  serve_cmd='pnpm run dev:notifications',
  serve_dir='.',
  deps=[],
  resource_deps=['db-push', 'nats', 'temporal', 'mailpit'],
  auto_init=False,
)

# ─── Infra ────────────────────────────────────────────────────────────────────

compose('./docker/compose.infra.yaml')

# Core infra — required for all dev work
dc_resource('postgres', labels=['infra'])
dc_resource('redis', labels=['infra'])
dc_resource('nats', labels=['infra'],
            links=[local_url('DEV_NATS_MONITOR_PORT', '8222')])
dc_resource('object-storage', labels=['infra'],
            links=[local_url('DEV_STORAGE_CONSOLE_PORT', '9003')])

# Temporal — workflow engine, only needed when working on async workflows
dc_resource('temporal', labels=['infra'], resource_deps=['postgres'])
dc_resource('temporal-ui', labels=['infra'], auto_init=False,
            links=[local_url('DEV_TEMPORAL_UI_PORT', '8233')])

# Mailpit — catches dev email from the notification service
dc_resource('mailpit', labels=['infra'],
            links=[local_url('DEV_MAILPIT_WEB_PORT', '8025')])

# ─── DB Utils ─────────────────────────────────────────────────────────────────

# Database cleanup — nukes DB and re-runs full pipeline
local_resource(
  'db-clean',
  cmd='pnpm run db:reset --seed',
  resource_deps=['postgres'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['dev-utils'],
)

# Drizzle Studio — visual database browser
local_resource(
  'database-gui',
  serve_cmd='pnpm run db:studio',
  resource_deps=['postgres'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['dev-utils'],
  links=['http://localhost:5555'],
)

# ─── Tests ────────────────────────────────────────────────────────────────────

local_resource(
  'unit-tests',
  cmd='pnpm run test',
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['tests'],
)

local_resource(
  'integration-tests',
  cmd='pnpm run test:int',
  resource_deps=['postgres'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['tests'],
)

local_resource(
  'e2e-gateway',
  cmd='pnpm run test:e2e:api',
  resource_deps=['api-gateway'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['tests'],
)

local_resource(
  'e2e-ui',
  cmd='pnpm run test:e2e:ui',
  resource_deps=['web', 'api-gateway'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['tests'],
)

local_resource(
  'test-all',
  cmd='pnpm run test:all',
  resource_deps=['postgres'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['tests'],
)

local_resource(
  'lint',
  cmd='pnpm run lint',
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['tests'],
)

# ─── NX ───────────────────────────────────────────────────────────────────────

local_resource(
  'typecheck',
  cmd='pnpm run typecheck',
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['nx'],
)

local_resource(
  'build-all',
  cmd='pnpm run build',
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['nx'],
)

local_resource(
  'nx-graph',
  serve_cmd='npx nx graph',
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['nx'],
  links=['http://localhost:4211'],
)

local_resource(
  'nx-reset',
  cmd='npx nx reset',
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['nx'],
)

# ─── Observability (manual) ──────────────────────────────────────────────────
# Start manually when debugging performance or tracing issues.
# Trigger `observability` to bring up the entire stack with one click.

dc_resource('prometheus', labels=['observability'], auto_init=False)
dc_resource('tempo', labels=['observability'], auto_init=False)
dc_resource('loki', labels=['observability'], auto_init=False)
dc_resource('otel-collector', labels=['observability'], resource_deps=['tempo', 'loki'],
            auto_init=False)
dc_resource('grafana', labels=['observability'], resource_deps=['prometheus', 'tempo', 'loki'],
            auto_init=False, links=[local_url('DEV_GRAFANA_PORT', '3001')])

# Aggregator: triggering this pulls up every observability dc_resource above.
local_resource(
  'observability',
  cmd='echo "Observability stack up: Grafana %s"' % local_url('DEV_GRAFANA_PORT', '3001'),
  resource_deps=['prometheus', 'tempo', 'loki', 'otel-collector', 'grafana'],
  trigger_mode=TRIGGER_MODE_MANUAL,
  auto_init=False,
  labels=['observability'],
  links=[local_url('DEV_GRAFANA_PORT', '3001')],
)
