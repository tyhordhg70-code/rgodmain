# AutoResolve RDP Scripts

Copy this entire folder to your RDP machine alongside `deploy/start-watcher.bat`.
The easiest way to start is to just double-click `start-watcher.bat` after filling in your credentials.

## Quick Start

1. Install **Python 3.11+** — https://www.python.org/downloads/ (tick "Add to PATH")
2. Edit `../start-watcher.bat` and fill in every `CHANGE_ME` value
3. Double-click `start-watcher.bat` — dependencies are installed automatically on first run

## Manual Setup (alternative)

```bash
pip install -r requirements.txt
playwright install chromium
```

Create a `.env` file or set environment variables before running:
```
API_BASE=https://refundgod.fans/api/retail
FORMS_API_KEY=your-api-key
DOLPHIN_API_TOKEN=your_dolphin_token
DOLPHIN_LOCAL_API=http://localhost:3001
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
PROXY_HOST=residential.spyderproxy.com
PROXY_PORT=7777
PROXY_USER=your_proxy_user
PROXY_PASS=your_proxy_pass
```

Then run:
```bash
python order_watcher.py
```

## Files

| File | Purpose |
|------|---------|
| `order_watcher.py` | Polls the API every 15 s for pending orders and triggers automation |
| `step1_handler.py` | Orchestrates all issue types end-to-end (DNA, EB, Step1, Step2, LIT, Followup) |
| `dolphin_manager.py` | Dolphin Anty profile creation, grouping, and auto-deletion |
| `return_systems.py` | Navigation handlers for 13+ return portals with multi-language support |
| `live_chat.py` | Live chat detection, opening, and multi-language conversation |
| `locale_strings.py` | UI strings, return reasons, and issue code aliases in 8 languages |
| `requirements.txt` | Python dependencies |

## How Automation Works

1. A Telegram message is sent to the bot (running on the Replit server)
2. The bot parses the message and creates orders in the database with status `pending`
3. `order_watcher.py` (running on the RDP) polls for `pending` orders
4. Each order is claimed (`in_progress`) and processed by `step1_handler.py`
5. Results are posted back to the API and Telegram

## Issue Types

| Code | What it does |
|------|-------------|
| `Step1` | Tries automated return portal, falls back to live chat if not found |
| `DNA` | Did Not Arrive — contacts CS via live chat |
| `EB` | Empty Box — contacts CS via live chat |
| `LIT` | Lost In Transit — contacts CS via live chat |
| `Step2` | Return Not Processed — contacts CS via live chat |
| `Followup` | Context-aware follow-up using original issue code from `[orig:X]` prefix |

## Telegram Message Format

### Single order
```
Amazon 114-7234567-8901234 DNA
```

### With customer info
```
Best Buy 86753090 EB John Smith john@email.com
```

### With notes
```
Amazon 114-7234567-8901234 Step1 Jane Doe jane@amazon.com
Item arrived with cracked screen, box was also crushed
```

### Bulk orders (one per line)
```
Amazon 114-1111111-1111111 DNA
Best Buy 86753090 EB Jane Doe jane@email.com
Target 5551234 Step1 Bob Brown bob@email.com
```

**Issue codes (multilingual):** `DNA` · `EB` · `Step1` · `Step2` · `LIT` · `Followup`
Foreign-language aliases (e.g. `retoure`, `nichtangekommen`) are also accepted.

## Dolphin Profile Rules

- **Same merchant + same customer** → shared profile, multiple tabs
- **Same merchant + different customer** → separate profile with its own proxy session
- **Different merchant** → reuse any compatible profile
- Profile names: `AR_Session1`, `AR_Session2`, …
- Profiles are **auto-deleted** when all orders in that group are complete

Manually clean up all AR_ profiles:
```bash
python -c "from dolphin_manager import *; import asyncio; asyncio.run(get_dolphin_manager().delete_autoresolve_profiles())"
```

## Supported Return Portals

1. Loop Returns
2. Narvar
3. AfterShip Returns
4. Returnly
5. Happy Returns
6. Rich Returns
7. ReturnGo
8. ClaimLane
9. ClickPost Returns
10. Ingrid Returns
11. Zigzag Returns
12. Aftercare Returns
13. Shopify Native
14. Generic fallback

## Multi-language Support

Return reasons and UI button text are fully localised for:
`en` · `de` · `fr` · `it` · `es` · `nl` · `ja` · `pt`

The page language is auto-detected from `<html lang>`, meta tags, or body text.
The agent's reply language is detected from live chat responses, and subsequent
messages switch to match automatically.
