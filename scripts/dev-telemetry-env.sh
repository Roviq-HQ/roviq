# Sourced (POSIX sh) by the dev server scripts after instance-env.sh.
# Telemetry is on when this instance's OpenObserve answers (Tilt `observability`), off otherwise.
# An OTEL_EXPORTER_OTLP_ENDPOINT set by the caller or in .env is left alone.
if [ -z "${OTEL_EXPORTER_OTLP_ENDPOINT+set}" ] &&
  ! grep -q '^OTEL_EXPORTER_OTLP_ENDPOINT=' .env 2>/dev/null &&
  curl -sf --max-time 1 -o /dev/null "http://localhost:${DEV_OPENOBSERVE_PORT:-5080}/healthz"; then
  _roviq_basic=$(printf '%s' 'dev@roviq.local:Roviq-observe-1' | base64 | tr -d '\n')
  export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:${DEV_OPENOBSERVE_GRPC_PORT:-5081}"
  export OTEL_EXPORTER_OTLP_HEADERS="authorization=Basic ${_roviq_basic},organization=default,stream-name=default"
  unset _roviq_basic
fi
