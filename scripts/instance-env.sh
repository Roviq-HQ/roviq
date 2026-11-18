# Sourced (POSIX sh) by shell and package.json scripts, normally from the repo root.
# Exports this checkout's instance variables from .env unless the caller already set them,
# so scripts run outside Tilt target the same ports and compose projects as Tilt does.
# Set ROVIQ_ENV_FILE first to read a .env that is not in the current directory.
_roviq_env_file="${ROVIQ_ENV_FILE:-.env}"
if [ -f "$_roviq_env_file" ]; then
  while IFS='=' read -r _roviq_key _roviq_value; do
    case "$_roviq_key" in
      *[!A-Z0-9_]*) continue ;;
      ROVIQ_INSTANCE | ROVIQ_COMPOSE_PROJECT | ROVIQ_E2E_COMPOSE_PROJECT | TILT_PORT | \
        API_GATEWAY_PORT | WEB_PORT | NOTIFICATION_SERVICE_PORT | *_INSPECT_PORT | DEV_*_PORT | E2E_*_PORT)
        eval "[ -n \"\${${_roviq_key}+set}\" ]" || export "${_roviq_key}=${_roviq_value}"
        ;;
    esac
  done <"$_roviq_env_file"
fi
unset _roviq_env_file _roviq_key _roviq_value ROVIQ_ENV_FILE
