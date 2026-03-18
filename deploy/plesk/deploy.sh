#!/usr/bin/env bash
# AutoResolve — Plesk Deployment Script
# Run from the project root on your dev machine:
#   bash deploy/plesk/deploy.sh
#
# Requirements: ssh access to the Plesk server (key-based recommended)

set -euo pipefail

# ── Config — edit these ───────────────────────────────────────────────────────
PLESK_HOST="${PLESK_HOST:-45.153.34.48}"
PLESK_USER="${PLESK_USER:-root}"
REMOTE_DIR="/var/www/vhosts/refundgod.fans/autoresolve"
WEB_ROOT="/var/www/vhosts/refundgod.fans/httpdocs"
SSH="ssh ${PLESK_USER}@${PLESK_HOST}"

echo "=== AutoResolve Deploy → ${PLESK_HOST} ==="

# ── 1. Build ──────────────────────────────────────────────────────────────────
echo ""
echo "▶ Building API server..."
pnpm --filter @workspace/api-server run build

echo ""
echo "▶ Building frontend..."
pnpm --filter @workspace/secure-response-hub run build

# ── 2. Ensure remote directories exist ───────────────────────────────────────
echo ""
echo "▶ Preparing remote directories..."
$SSH "mkdir -p ${REMOTE_DIR}/dist ${WEB_ROOT}"

# ── 3. Upload API server ──────────────────────────────────────────────────────
echo ""
echo "▶ Uploading API server bundle..."
rsync -az --progress \
  artifacts/api-server/dist/index.cjs \
  deploy/plesk/ecosystem.config.cjs \
  "${PLESK_USER}@${PLESK_HOST}:${REMOTE_DIR}/"

# Upload env example only if .env doesn't already exist on server
$SSH "[ -f ${REMOTE_DIR}/.env ] || echo '⚠ No .env found — copy deploy/plesk/env.production.example to ${REMOTE_DIR}/.env and fill in values'"

# ── 4. Upload frontend static files ──────────────────────────────────────────
echo ""
echo "▶ Uploading frontend..."
rsync -az --delete --progress \
  artifacts/secure-response-hub/dist/public/ \
  "${PLESK_USER}@${PLESK_HOST}:${WEB_ROOT}/"

# ── 5. Ensure PM2 is installed and (re)start the API ─────────────────────────
echo ""
echo "▶ Restarting API server via PM2..."
$SSH bash -s << 'REMOTE'
  set -e
  # Install PM2 globally if missing
  command -v pm2 >/dev/null 2>&1 || npm install -g pm2

  # Create log directory
  mkdir -p /var/log/pm2

  # Reload or start
  cd /var/www/vhosts/refundgod.fans/autoresolve
  if pm2 show autoresolve-api >/dev/null 2>&1; then
    pm2 reload ecosystem.config.cjs --update-env
    echo "✓ PM2 reloaded"
  else
    pm2 start ecosystem.config.cjs
    pm2 save
    echo "✓ PM2 started"
  fi

  # Enable PM2 startup on reboot (first time only)
  pm2 startup 2>/dev/null | grep "sudo" | bash || true
REMOTE

echo ""
echo "=== Deploy complete ==="
echo ""
echo "Next steps if this is a first deploy:"
echo "  1. SSH to ${PLESK_HOST} and create ${REMOTE_DIR}/.env from env.production.example"
echo "  2. In Plesk: Websites & Domains → refundgod.fans → Apache & Nginx Settings"
echo "     → paste the contents of deploy/plesk/nginx-snippet.conf into 'Additional Nginx directives'"
echo "  3. Click Apply — Telegram webhook will register automatically when the API starts"
echo ""
echo "  The Telegram bot will automatically register its webhook at:"
echo "  https://refundgod.fans/api/telegram/webhook"
