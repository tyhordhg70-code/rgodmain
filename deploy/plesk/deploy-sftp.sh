#!/usr/bin/env bash
# Secure-Response-Hub — Plesk SFTP Deploy
# Works without SSH shell access — uploads via SFTP only.
#
# Usage (from project root):
#   PLESK_USER=your_user PLESK_PASS=your_pass bash deploy/plesk/deploy-sftp.sh
#
# Or set credentials as env vars in your shell before running.

set -euo pipefail

PLESK_HOST="${PLESK_HOST:-45.153.34.48}"
PLESK_USER="${PLESK_USER:-}"
PLESK_PASS="${PLESK_PASS:-}"
REMOTE_DIR="/httpdocs"

# ── Validate ──────────────────────────────────────────────────────────────────
if [[ -z "$PLESK_USER" || -z "$PLESK_PASS" ]]; then
  echo "ERROR: Set PLESK_USER and PLESK_PASS environment variables first."
  echo "  export PLESK_USER=your_username"
  echo "  export PLESK_PASS=your_password"
  exit 1
fi

echo "=== Secure-Response-Hub → Plesk SFTP Deploy ==="
echo "Host: $PLESK_HOST"
echo "User: $PLESK_USER"
echo "Remote: $REMOTE_DIR"
echo ""

# ── 1. Build ──────────────────────────────────────────────────────────────────
echo "▶ Building API server..."
pnpm --filter @workspace/api-server run build

echo "▶ Building frontend..."
pnpm --filter @workspace/secure-response-hub run build

# ── 2. Stage deploy directory ─────────────────────────────────────────────────
echo ""
echo "▶ Staging files..."
STAGE=$(mktemp -d)
trap "rm -rf $STAGE" EXIT

# API server — renamed to start.cjs (Plesk startup file)
cp artifacts/api-server/dist/index.cjs "$STAGE/start.cjs"

# Frontend static files — Plesk/Passenger serves /httpdocs/public/ statically
mkdir -p "$STAGE/public"
cp -r artifacts/secure-response-hub/dist/public/. "$STAGE/public/"

echo "  start.cjs        $(du -sh "$STAGE/start.cjs" | cut -f1)"
echo "  public/          $(du -sh "$STAGE/public" | cut -f1)"

# ── 3. Upload via SFTP ────────────────────────────────────────────────────────
echo ""
echo "▶ Uploading via SFTP..."

# Try lftp first (handles directories best), fall back to Python paramiko
if command -v lftp >/dev/null 2>&1; then
  echo "  Using lftp..."
  lftp -u "$PLESK_USER,$PLESK_PASS" \
       -e "set sftp:auto-confirm yes; set net:timeout 30; \
           mirror -R --delete --verbose $STAGE/ $REMOTE_DIR/; \
           quit" \
       "sftp://$PLESK_HOST"

elif python3 -c "import paramiko" 2>/dev/null; then
  echo "  Using Python paramiko..."
  python3 - "$PLESK_HOST" "$PLESK_USER" "$PLESK_PASS" "$STAGE" "$REMOTE_DIR" << 'PYEOF'
import sys, os, paramiko
host, user, password, local_dir, remote_dir = sys.argv[1:]

transport = paramiko.Transport((host, 22))
transport.connect(username=user, password=password)
sftp = paramiko.SFTPClient.from_transport(transport)

def upload_dir(local, remote):
    try:
        sftp.mkdir(remote)
    except:
        pass
    for item in os.listdir(local):
        lpath = os.path.join(local, item)
        rpath = remote.rstrip('/') + '/' + item
        if os.path.isdir(lpath):
            upload_dir(lpath, rpath)
        else:
            print(f"  Uploading {rpath}")
            sftp.put(lpath, rpath)

upload_dir(local_dir, remote_dir)
sftp.close()
transport.close()
print("Upload complete.")
PYEOF

else
  echo ""
  echo "  lftp and paramiko not found."
  echo "  Staged files are at: $STAGE"
  echo "  Please upload manually via FileZilla:"
  echo "    Host:     sftp://$PLESK_HOST"
  echo "    User:     $PLESK_USER"
  echo "    Password: (your Plesk password)"
  echo "    Port:     22"
  echo "    Upload the contents of $STAGE → $REMOTE_DIR"
  echo ""
  echo "  Files to upload:"
  find "$STAGE" -type f | sed "s|$STAGE/||"
  # Keep staging dir alive so user can upload manually
  trap - EXIT
  exit 0
fi

echo ""
echo "=== Deploy complete! ==="
echo ""
echo "Plesk environment variables to set (if not already set):"
echo "  In Plesk → your domain → Node.js → Environment Variables:"
echo ""
echo "  DATABASE_URL        = (your Neon PostgreSQL connection string)"
echo "  DASHBOARD_PASSWORD  = (your dashboard password)"
echo "  TELEGRAM_BOT_TOKEN  = (your Telegram bot token)"
echo "  TELEGRAM_CHAT_ID    = (your Telegram chat ID)"
echo "  SESSION_SECRET      = (random 64-char string)"
echo "  NODE_ENV            = production"
echo "  PUBLIC_DOMAIN       = refundgod.fans"
echo ""
echo "Then in Plesk → Node.js → click Restart App."
