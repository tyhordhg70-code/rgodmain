"""
Order Watcher — AutoResolve RDP
Polls the API for pending orders and triggers automation.

Setup on your RDP machine:
  1. Set environment variables (or use start-watcher.bat which sets them for you):
       set API_BASE=https://refundgod.fans/api/retail
       set FORMS_API_KEY=your-api-key-here
       set TELEGRAM_BOT_TOKEN=your-bot-token
       set TELEGRAM_CHAT_ID=your-chat-id
       set DOLPHIN_LOCAL_API=http://localhost:3001
       set DOLPHIN_API_TOKEN=your-dolphin-token
       set PROXY_USER=your-proxy-user
       set PROXY_PASS=your-proxy-pass

  2. Run:
       python order_watcher.py

  The watcher checks for pending orders every 15 seconds and
  automatically triggers step1_handler for each batch.
"""
import asyncio
import logging
import os
import signal
import sys
from typing import List

import httpx

from step1_handler import handle_automation_trigger

logger = logging.getLogger("order_watcher")

API_BASE = os.environ.get("API_BASE", "https://refundgod.fans/api/retail")
API_KEY = os.environ.get("FORMS_API_KEY", "")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "15"))
# Set VERIFY_SSL=0 to skip certificate verification (use while SSL cert is not yet issued)
VERIFY_SSL = os.environ.get("VERIFY_SSL", "1").strip() not in ("0", "false", "no")

_running = True
_active_order_ids: set = set()


def _api_headers() -> dict:
    h = {}
    if API_KEY:
        h["x-api-key"] = API_KEY
    return h


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=15, verify=VERIFY_SSL)


async def fetch_pending_orders() -> List[dict]:
    try:
        async with _client() as c:
            r = await c.get(
                f"{API_BASE}/orders",
                params={"status": "pending"},
                headers=_api_headers(),
            )
            r.raise_for_status()
            orders = r.json()
            if isinstance(orders, list):
                return orders
            return []
    except Exception as exc:
        logger.warning(f"Failed to fetch pending orders: {exc}")
        return []


async def mark_in_progress(order_id: str) -> bool:
    try:
        async with _client() as c:
            r = await c.patch(
                f"{API_BASE}/orders/{order_id}",
                json={"status": "in_progress"},
                headers=_api_headers(),
            )
            r.raise_for_status()
            return True
    except Exception as exc:
        logger.warning(f"Failed to mark order {order_id} in_progress: {exc}")
        return False


async def rollback_to_pending(order_id: str):
    try:
        async with _client() as c:
            r = await c.patch(
                f"{API_BASE}/orders/{order_id}",
                json={"status": "pending"},
                headers=_api_headers(),
            )
            r.raise_for_status()
            logger.info(f"Rolled back order {order_id} to pending")
    except Exception as exc:
        logger.error(f"Failed to rollback order {order_id}: {exc}")


async def poll_and_process():
    global _active_order_ids

    orders = await fetch_pending_orders()
    if not orders:
        return

    new_orders = [o for o in orders if o.get("id") not in _active_order_ids]
    if not new_orders:
        return

    order_ids = [o["id"] for o in new_orders]
    merchants = [o.get("merchant_name", "?") for o in new_orders]
    logger.info(f"Found {len(new_orders)} new pending order(s): {', '.join(merchants)}")

    claimed_ids = []
    for oid in order_ids:
        ok = await mark_in_progress(oid)
        if ok:
            _active_order_ids.add(oid)
            claimed_ids.append(oid)
        else:
            logger.warning(f"Could not claim order {oid} — skipping")

    if not claimed_ids:
        return

    try:
        logger.info(f"Calling handle_automation_trigger for {claimed_ids}")
        await handle_automation_trigger(claimed_ids)
        logger.info(f"handle_automation_trigger returned normally for {claimed_ids}")
    except Exception as exc:
        logger.error(f"Automation batch failed: {type(exc).__name__}: {exc}")
        for oid in claimed_ids:
            await rollback_to_pending(oid)
    finally:
        for oid in claimed_ids:
            _active_order_ids.discard(oid)


async def main_loop():
    logger.info(f"Order watcher started — polling every {POLL_INTERVAL}s")
    logger.info(f"API: {API_BASE}")
    logger.info(f"Auth: {'API key configured' if API_KEY else 'NO API KEY — requests will fail'}")

    while _running:
        try:
            await poll_and_process()
        except Exception as exc:
            logger.error(f"Poll cycle error: {exc}")
        await asyncio.sleep(POLL_INTERVAL)

    logger.info("Order watcher stopped")


def _shutdown(sig, frame):
    global _running
    logger.info(f"Received signal {sig}, shutting down...")
    _running = False


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    logger.info(f"=== WATCHER v2 LOADED FROM: {__file__} ===")

    if not API_KEY:
        logger.warning("FORMS_API_KEY not set — API calls will be rejected (401)")
    if not API_BASE or "localhost" in API_BASE:
        logger.warning(f"API_BASE is '{API_BASE}' — set it to your Replit app URL")

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    asyncio.run(main_loop())
