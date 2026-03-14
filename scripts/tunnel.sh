#!/usr/bin/env bash
# Start a Cloudflare Tunnel to expose the local API gateway to the internet.
# Used for testing payment gateway webhooks (Razorpay, Cashfree) in dev.
#
# Setup (one-time per device):
#   1. Install cloudflared
#   2. cloudflared tunnel login
#   3. cloudflared tunnel create roviq-dev
#   4. cloudflared tunnel route dns roviq-dev <subdomain>.<domain>
#   5. Set CLOUDFLARE_TUNNEL_ID and CLOUDFLARE_TUNNEL_HOSTNAME in .env
#   6. Run this script: ./scripts/tunnel.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/.env"
set +a

: "${CLOUDFLARE_TUNNEL_ID:?Set CLOUDFLARE_TUNNEL_ID in .env}"
: "${CLOUDFLARE_TUNNEL_HOSTNAME:?Set CLOUDFLARE_TUNNEL_HOSTNAME in .env}"

CONFIG=$(mktemp)
trap 'rm -f "$CONFIG"' EXIT

cat > "$CONFIG" <<EOF
tunnel: ${CLOUDFLARE_TUNNEL_ID}
credentials-file: ${HOME}/.cloudflared/${CLOUDFLARE_TUNNEL_ID}.json

ingress:
  - hostname: ${CLOUDFLARE_TUNNEL_HOSTNAME}
    service: http://localhost:${API_GATEWAY_PORT:-3000}
  - service: http_status:404
EOF

echo "Tunnel: https://${CLOUDFLARE_TUNNEL_HOSTNAME} → http://localhost:${API_GATEWAY_PORT:-3000}"
echo "Razorpay webhook: https://${CLOUDFLARE_TUNNEL_HOSTNAME}/api/webhooks/razorpay"
echo "Cashfree webhook: https://${CLOUDFLARE_TUNNEL_HOSTNAME}/api/webhooks/cashfree"

CLOUDFLARED=$(command -v cloudflared 2>/dev/null || echo "$HOME/.local/bin/cloudflared")
if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "Error: cloudflared not found. Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

"$CLOUDFLARED" tunnel --config "$CONFIG" run
