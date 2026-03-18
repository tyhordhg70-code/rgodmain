# AutoResolve — Deployment Guide (Plesk / refundgod.fans)

**Server:** `45.153.34.48` · **Domain:** `refundgod.fans` · **RDP relay:** `64.188.112.247:4001`

---

## How It Works

```
Telegram  ──→  API server (Node.js, PM2, port 3000)  ──→  Neon PostgreSQL
                      │                 ↑
                      │        webhooks / polling
                      ↓
               Nginx (Plesk-managed)
               /api/* → localhost:3000
               /* → React static files (httpdocs/)
                      │
                      ↓
              Relay Agent (port 4001 on RDP at 64.188.112.247)
                      │
                      ↓
              Dolphin Anty (localhost:3001 on RDP)
                      │
                      ↓
              order_watcher.py → step1_handler.py (Playwright)
```

The Telegram bot registers its webhook at `https://refundgod.fans/api/telegram/webhook`
automatically when `NODE_ENV=production` and `PUBLIC_DOMAIN=refundgod.fans` are set.

---

## First-Time Plesk Setup

### 1. SSH into the server

```bash
ssh root@45.153.34.48
```

### 2. Install Node.js 20+ and PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pm2
```

### 3. Create the app directory

```bash
mkdir -p /var/www/vhosts/refundgod.fans/autoresolve
```

### 4. Create the `.env` file

```bash
# On your dev machine — copy the example up to the server
scp deploy/plesk/env.production.example root@45.153.34.48:/var/www/vhosts/refundgod.fans/autoresolve/.env
# Then on the server, fill in all values
ssh root@45.153.34.48
nano /var/www/vhosts/refundgod.fans/autoresolve/.env
```

Critical values to set:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `PUBLIC_DOMAIN` | `refundgod.fans` |
| `DATABASE_URL` | Your Neon PostgreSQL connection string |
| `SESSION_SECRET` | 64+ random chars |
| `DASHBOARD_PASSWORD_HASH` | bcrypt hash of your dashboard password |
| `ENCRYPTION_KEY` | 32-char AES key |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID |
| `RELAY_URL` | `http://64.188.112.247:4001` |
| `RELAY_SECRET` | Shared secret with relay agent |
| `FORMS_API_KEY` | API key for form/RDP authentication |

### 5. Add Nginx proxy rules in Plesk

In Plesk: **Websites & Domains → refundgod.fans → Apache & Nginx Settings → Additional Nginx directives**

Paste the contents of `deploy/plesk/nginx-snippet.conf` (reproduced below):

```nginx
client_max_body_size 10m;

location /api/ {
    proxy_pass         http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade    $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host       $host;
    proxy_set_header   X-Real-IP  $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}

location / {
    root   /var/www/vhosts/refundgod.fans/httpdocs;
    try_files $uri $uri/ /index.html;
    index  index.html;
}
```

Click **Apply**. SSL is already managed by Plesk's Let's Encrypt integration.

---

## Deploying Updates

From the project root on your dev machine:

```bash
bash deploy/plesk/deploy.sh
```

This builds both the API and frontend, uploads them via rsync, and restarts PM2.

**Manually on the server:**

```bash
# Restart API
pm2 reload autoresolve-api

# Live logs
pm2 logs autoresolve-api

# Check status
pm2 status
```

---

## Relay Agent Setup (RDP at 64.188.112.247)

The relay runs on the Windows RDP and bridges the Plesk server → Dolphin Anty.

1. Copy `deploy/relay-agent.cjs` and `deploy/start-relay.bat` to `C:\AutoResolve\` on the RDP
2. Edit `start-relay.bat` — fill in `DOLPHIN_API_TOKEN`, `RELAY_SECRET`, proxy credentials
3. Double-click `start-relay.bat` — keep the window open
4. Open Windows Firewall and allow TCP port 4001 inbound:
   ```powershell
   New-NetFirewallRule -DisplayName "AutoResolve Relay" -Direction Inbound -Protocol TCP -LocalPort 4001 -Action Allow
   ```
5. Add to Windows Task Scheduler to auto-start at login (optional)

---

## Order Watcher Setup (RDP — Python automation)

Copy the entire `deploy/rdp-scripts/` folder to `C:\AutoResolve\rdp-scripts\`.

1. Install **Python 3.11+** (tick "Add to PATH" during install)
2. `pip install -r C:\AutoResolve\rdp-scripts\requirements.txt`
3. Edit `deploy/start-watcher.bat` — fill in all `CHANGE_ME` values
4. Double-click `start-watcher.bat`

The watcher polls `https://refundgod.fans/api/retail/orders?status=pending` every 15 seconds
and runs Dolphin Anty + Playwright automation for each new order.

---

## Telegram Bot Activation

When the API starts on the Plesk server:
1. It registers the webhook: `https://refundgod.fans/api/telegram/webhook`
2. PM2 logs will show: `[telegram-bot] Webhook registered: https://refundgod.fans/api/telegram/webhook`
3. Send your **dashboard password** to the bot in Telegram
4. Session stays active for 5 hours

In the Replit dev environment, the bot uses long-polling — no webhook setup needed there.
