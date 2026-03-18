"""
Dolphin Anty Profile Manager — AutoResolve RDP
Handles profile creation, assignment, tab tracking, and auto-deletion.

Profile grouping rule:
  - Same merchant + same customer  = same Dolphin profile (multiple tabs)
  - Same merchant + diff customer  = separate Dolphin profile
  - Different merchant             = reuse any compatible profile (new tab)
  - All orders on a profile done   → stop + delete profile automatically

Proxy:
  - Each NEW profile gets a UNIQUE SpyderProxy session ID + country matching
    the delivery region of the first order assigned to that profile.
  - Region is normalised via REGION_TO_PROXY_COUNTRY before being sent to SpyderProxy.
"""
import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

DOLPHIN_LOCAL_API    = os.environ.get("DOLPHIN_LOCAL_API",    "http://localhost:3001")
DOLPHIN_CLOUD_API    = os.environ.get("DOLPHIN_CLOUD_API",    "https://dolphin-anty-api.com")
DOLPHIN_API_TOKEN    = os.environ.get("DOLPHIN_API_TOKEN",    "")   # Cloud JWT (eyJ…)
DOLPHIN_LOCAL_TOKEN  = os.environ.get("DOLPHIN_LOCAL_TOKEN",  "")   # Local app token (Settings → API)
DOLPHIN_EMAIL        = os.environ.get("DOLPHIN_EMAIL",        "")
DOLPHIN_PASSWORD     = os.environ.get("DOLPHIN_PASSWORD",     "")

# SpyderProxy credentials
PROXY_HOST = os.environ.get("PROXY_HOST", "budget.spyderproxy.com")
PROXY_PORT = int(os.environ.get("PROXY_PORT", "11000"))
PROXY_USER = os.environ.get("PROXY_USER", "")
PROXY_PASS = os.environ.get("PROXY_PASS", "")
PROXY_COUNTRY = os.environ.get("PROXY_COUNTRY", "us")

# ─── Region → SpyderProxy country code ───────────────────────────────────────

REGION_TO_PROXY_COUNTRY: Dict[str, str] = {
    # United States
    "us": "us", "usa": "us", "united states": "us", "america": "us",
    # United Kingdom
    "uk": "gb", "gb": "gb", "united kingdom": "gb", "england": "gb",
    "britain": "gb", "great britain": "gb",
    # Canada
    "ca": "ca", "canada": "ca",
    # Australia
    "au": "au", "australia": "au",
    # Germany
    "de": "de", "germany": "de", "deutschland": "de",
    # France
    "fr": "fr", "france": "fr",
    # Italy
    "it": "it", "italy": "it",
    # Spain
    "es": "es", "spain": "es",
    # Netherlands
    "nl": "nl", "netherlands": "nl", "holland": "nl",
    # Japan
    "jp": "jp", "japan": "jp",
    # Mexico
    "mx": "mx", "mexico": "mx",
    # Brazil
    "br": "br", "brazil": "br",
    # India
    "in": "in", "india": "in",
}


def normalize_region(region: Optional[str]) -> str:
    """Normalise any region/country string to a 2-letter SpyderProxy country code."""
    if not region:
        return PROXY_COUNTRY
    return REGION_TO_PROXY_COUNTRY.get(region.lower().strip(), PROXY_COUNTRY)


# ─── Retry helper ─────────────────────────────────────────────────────────────

async def retry_async(
    coro_fn,
    label: str,
    max_attempts: int = 4,
    base_delay: float = 1.0,
    retryable_statuses=(429, 500, 502, 503, 504),
):
    """
    Retry an async function with exponential backoff.
    Handles HTTP 429 (rate limit) and transient server errors.
    Returns None if all attempts fail.
    """
    for attempt in range(1, max_attempts + 1):
        try:
            return await coro_fn()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 429:
                # Honour Retry-After header when present
                retry_after = float(exc.response.headers.get("Retry-After", base_delay * (2 ** attempt)))
                logger.warning(f"[dolphin] {label} rate-limited (429), waiting {retry_after:.1f}s (attempt {attempt})")
                await asyncio.sleep(retry_after)
            elif status in retryable_statuses:
                delay = base_delay * (2 ** (attempt - 1))
                logger.warning(f"[dolphin] {label} HTTP {status}, retrying in {delay:.1f}s (attempt {attempt})")
                await asyncio.sleep(delay)
            else:
                logger.error(f"[dolphin] {label} non-retryable HTTP {status}: {exc.response.text[:200]}")
                return None
        except (httpx.ConnectError, httpx.TimeoutException) as exc:
            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(f"[dolphin] {label} connection error: {exc}, retrying in {delay:.1f}s (attempt {attempt})")
            await asyncio.sleep(delay)
        except Exception as exc:
            logger.error(f"[dolphin] {label} unexpected error: {exc}")
            return None

    logger.error(f"[dolphin] {label} failed after {max_attempts} attempts")
    return None


# ─── Proxy session factory ────────────────────────────────────────────────────

def new_proxy_session_id() -> str:
    """Generate a unique proxy session ID (8 hex chars from UUID4)."""
    return uuid.uuid4().hex[:12]


def build_proxy_config(session_id: str, country: str = None) -> Optional[dict]:
    """
    Build Dolphin proxy config for SpyderProxy SOCKS5 with STICKY sessions.

    Sticky session format: {user}-session-{session_id}-country-{country}
    This locks the profile to a single residential IP for its entire lifetime,
    preventing IP changes between page loads which trigger fraud detection.

    Each profile gets a unique session_id (12-char hex UUID fragment) so that
    different profiles always get different IPs even if run concurrently.

    host: budget.spyderproxy.com  port: 11000  type: socks5
    """
    if not PROXY_USER or not PROXY_PASS:
        logger.warning("[dolphin] No proxy credentials configured — profile will have no proxy")
        return None

    cc = (country or PROXY_COUNTRY or "us").lower()

    # Build the sticky-session username:
    # SpyderProxy format: username-session-SESSIONID-country-CC
    # This keeps the same residential IP for all connections under this session.
    login = f"{PROXY_USER}-session-{session_id}-country-{cc}"

    logger.info(
        f"[dolphin] Proxy config: type=socks5 host={PROXY_HOST}:{PROXY_PORT} "
        f"user={PROXY_USER[:4]}*** session={session_id} country={cc}"
    )

    cfg = {
        "type": "socks5",
        "host": PROXY_HOST,
        "port": PROXY_PORT,
        "login": login,
        "password": PROXY_PASS,
    }
    return cfg


# ─── Data classes ─────────────────────────────────────────────────────────────

@dataclass
class ProfileSlot:
    """Tracks a live Dolphin profile and its assigned orders."""
    profile_id: str
    profile_name: str
    proxy_session_id: str          # unique per profile for SpyderProxy
    proxy_country: str = "us"      # 2-letter country code the proxy is locked to
    # merchant (lowercase) → set of customer keys that have tabs in this profile
    merchant_customers: Dict[str, set] = field(default_factory=dict)
    order_ids: List[str] = field(default_factory=list)
    active_tabs: int = 0
    completed: int = 0
    cdp_port: Optional[int] = None

    def is_compatible(self, merchant: str, customer_key: str) -> bool:
        """
        A profile is compatible with an order when:
          - This merchant has no tabs in the profile yet (any customer OK), OR
          - This merchant already has tabs but only for the same customer.
        Incompatible when the same merchant is present with a different customer
        (would cause session/cookie conflict on the same site).
        """
        existing = self.merchant_customers.get(merchant.lower())
        if existing is None:
            return True                         # merchant not in profile yet
        return existing == {customer_key}       # same merchant, same customer only


# ─── Dolphin Manager ──────────────────────────────────────────────────────────

class DolphinManager:
    """
    Manages Dolphin Anty browser profiles.
    Each profile gets a dedicated unique SpyderProxy residential IP session.
    """

    def __init__(self):
        self._local_client: Optional[httpx.AsyncClient] = None
        self._cloud_client: Optional[httpx.AsyncClient] = None
        self._profiles: List[ProfileSlot] = []
        self._lock = asyncio.Lock()
        self._authenticated = False

    # ─── HTTP clients ─────────────────────────────────────────────────────────

    async def _local(self) -> httpx.AsyncClient:
        """
        Local API client (localhost:3001) — used for start/stop only.

        Auth flow per Dolphin Anty docs:
          1. POST /v1.0/auth/login-with-token — NO auth header, body: {"token": API_TOKEN}
          2. All subsequent requests           — Authorization: Bearer <same API_TOKEN>
        """
        if self._local_client is None:
            local_token = DOLPHIN_LOCAL_TOKEN or DOLPHIN_API_TOKEN
            # Step 1: client starts with NO Authorization header — required for login call
            self._local_client = httpx.AsyncClient(
                base_url=DOLPHIN_LOCAL_API,
                timeout=httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0),
                headers={"Content-Type": "application/json"},
            )
            if local_token:
                try:
                    r = await self._local_client.post(
                        "/v1.0/auth/login-with-token",
                        json={"token": local_token},
                    )
                    logger.info(f"[dolphin] Local login: {r.status_code} {r.text[:160]}")
                    # Step 2: after login, attach Bearer for all subsequent calls
                    self._local_client.headers["Authorization"] = f"Bearer {local_token}"
                    logger.info("[dolphin] Local API session established — Bearer token attached")
                except Exception as e:
                    logger.warning(f"[dolphin] Local API login error: {e}")
        return self._local_client

    async def _cloud(self) -> httpx.AsyncClient:
        """Cloud API client (dolphin-anty-api.com) — used for profile CRUD."""
        if self._cloud_client is None:
            self._cloud_client = httpx.AsyncClient(
                base_url=DOLPHIN_CLOUD_API,
                timeout=30.0,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {DOLPHIN_API_TOKEN}",
                },
            )
        return self._cloud_client

    # ─── Auth ─────────────────────────────────────────────────────────────────

    async def authenticate(self) -> bool:
        if not DOLPHIN_API_TOKEN:
            logger.error("[dolphin] No DOLPHIN_API_TOKEN set")
            return False
        token_preview = DOLPHIN_API_TOKEN[:8] + "..." if len(DOLPHIN_API_TOKEN) > 8 else "(too short)"
        logger.info(f"[dolphin] Using cloud API with token: {token_preview}")
        # Validate by listing profiles — cloud API accepts JWT directly
        try:
            c = await self._cloud()
            r = await c.get("/browser_profiles?limit=1")
            if r.status_code == 200:
                self._authenticated = True
                logger.info("[dolphin] Cloud API authenticated successfully")
                return True
            logger.error(f"[dolphin] Cloud API auth check failed: {r.status_code} {r.text[:200]}")
            return False
        except Exception as e:
            logger.error(f"[dolphin] Cloud API auth check error: {e}")
            return False

    async def _ensure_auth(self):
        if not self._authenticated:
            await self.authenticate()

    # ─── Profile CRUD (cloud API) ──────────────────────────────────────────────

    async def _create_profile(self, name: str, session_id: str, country: str = None) -> Optional[str]:
        """Create a new Dolphin profile via cloud API."""
        await self._ensure_auth()

        proxy_cfg = build_proxy_config(session_id, country)
        payload = {
            "name": name,
            "tags": [],
            "platform": "windows",
            "browserType": "anty",
            "mainWebsite": "",
            "useragent": {
                "mode": "manual",
                "value": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            },
            "webrtc": {"mode": "altered", "ipAddress": None},
            "canvas": {"mode": "real"},
            "webgl": {"mode": "real"},
            "webglInfo": {
                "mode": "manual",
                "vendor": "Google Inc. (NVIDIA)",
                "renderer": "ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Direct3D11 vs_5_0 ps_5_0, D3D11)",
                "webgl2Maximum": "",
            },
            "clientRect": {"mode": "real"},
            "notes": {
                "content": None,
                "color": "blue",
                "style": "text",
                "icon": "info",
            },
            "timezone": {"mode": "auto", "value": None},
            "locale": {"mode": "auto", "value": None},
            "geolocation": {"mode": "auto", "latitude": None, "longitude": None, "accuracy": None},
            "cpu": {"mode": "manual", "value": 4},
            "memory": {"mode": "manual", "value": 4},
            "screen": {"mode": "real", "resolution": None},
            "audio": {"mode": "real"},
            "mediaDevices": {
                "mode": "real",
                "audioInputs": None,
                "videoInputs": None,
                "audioOutputs": None,
            },
            "ports": {"mode": "protect", "blacklist": "3389,5900,5800,7070,6568,5938"},
            "doNotTrack": False,
            "statusId": 0,
            "platformVersion": "0.1.0",
            "uaFullVersion": "122.0.0.0",
            "appCodeName": "Mozilla",
            "platformName": "Win32",
            "connectionDownlink": 4.15,
            "connectionEffectiveType": "4g",
            "connectionRtt": 50,
            "connectionSaveData": 0,
            "cpuArchitecture": "amd64",
            "osVersion": "10",
            "vendorSub": "",
            "productSub": "20030107",
            "vendor": "Google Inc.",
            "product": "Gecko",
            "fonts": {"mode": "auto"},
        }
        if proxy_cfg:
            payload["proxy"] = proxy_cfg

        payload["args"] = []

        async def _create():
            c = await self._cloud()
            r = await c.post("/browser_profiles", json=payload)
            if not r.is_success:
                logger.error(f"[dolphin] create_profile cloud error {r.status_code}: {r.text[:300]}")
            r.raise_for_status()
            return r

        result = await retry_async(_create, f"create_profile:{name}", max_attempts=3, base_delay=2.0)
        if result:
            data = result.json()
            pid = str(data.get("browserProfileId") or data.get("id") or (data.get("data") or {}).get("id", ""))
            logger.info(f"[dolphin] Created profile '{name}' → {pid} (proxy session: {session_id})")
            return pid

        return None

    async def _wait_for_local_sync(self, profile_id: str, timeout: int = 30) -> bool:
        """
        Wait for the Dolphin desktop app to sync the newly-created cloud profile locally.
        The GET /browser_profiles/{id} endpoint requires a separate auth scope that our
        token does not satisfy, so we use a fixed sleep instead of polling.
        The /start endpoint works correctly without this check.
        """
        wait = min(timeout, 10)
        logger.info(f"[dolphin] Waiting {wait}s for local app to sync profile {profile_id}...")
        await asyncio.sleep(wait)
        return True

    async def delete_profile(self, profile_id: str) -> bool:
        """Delete a Dolphin profile via cloud API."""
        await self._ensure_auth()

        async def _del():
            c = await self._cloud()
            r = await c.delete(f"/browser_profiles/{profile_id}")
            r.raise_for_status()
            return r

        result = await retry_async(_del, f"delete_profile:{profile_id}", max_attempts=3, base_delay=1.0)
        if result:
            logger.info(f"[dolphin] Deleted profile {profile_id}")
            return True
        return False

    # ─── Start / Stop (local API) ──────────────────────────────────────────────

    async def start_profile(self, profile_id: str) -> Optional[int]:
        """Start a profile via local API and return the CDP debug port.

        Uses /start?automation=1 as confirmed by Dolphin support.
        Dolphin allocates the CDP port itself and returns it in the response —
        we must NOT set --remote-debugging-port in profile args or it conflicts.
        Stops any duplicate first, then reads the port from the JSON response.
        """
        # Stop first to avoid E_BROWSER_RUN_DUPLICATE on retries
        await self.stop_profile(profile_id)
        await asyncio.sleep(2)

        async def _start():
            c = await self._local()
            r = await c.get(f"/v1.0/browser_profiles/{profile_id}/start?automation=1")
            if not r.is_success:
                logger.error(f"[dolphin] start_profile {profile_id} HTTP {r.status_code}: {r.text[:300]}")
            r.raise_for_status()
            return r

        result = await retry_async(_start, f"start_profile:{profile_id}", max_attempts=5, base_delay=5.0)
        if result:
            data = result.json()
            # Dolphin returns port inside automation object: {"automation": {"port": 12345}}
            port = (
                (data.get("automation") or {}).get("port")
                or (data.get("data") or {}).get("port")
                or data.get("port")
            )
            if port:
                port = int(port)
                logger.info(f"[dolphin] Started profile {profile_id}, CDP port={port}, waiting 3s...")
                await asyncio.sleep(3)
                return port
            logger.error(f"[dolphin] start_profile: no port in response: {data}")
        return None

    async def stop_profile(self, profile_id: str) -> bool:
        """Stop a running profile via local API."""
        try:
            c = await self._local()
            r = await c.get(f"/v1.0/browser_profiles/{profile_id}/stop")
            return r.status_code == 200
        except Exception as e:
            logger.error(f"[dolphin] Stop profile {profile_id} error: {e}")
            return False

    # ─── Slot management ──────────────────────────────────────────────────────

    @staticmethod
    def _customer_key(email: Optional[str], name: Optional[str]) -> str:
        if email:
            return email.lower().strip()
        if name:
            return name.lower().strip()
        return "unknown"

    async def get_or_create_slot(
        self,
        merchant: str,
        order_id: str,
        customer_email: Optional[str] = None,
        customer_name: Optional[str] = None,
        country: str = None,
    ) -> Optional[ProfileSlot]:
        """
        Profile assignment rules:
          - Same merchant + same customer  → reuse existing profile (new tab)
          - Different merchant             → reuse any compatible profile (new tab)
          - Same merchant + diff customer  → must create a new profile + new proxy
        Scans the live profile list for the first compatible slot.
        """
        ckey = self._customer_key(customer_email, customer_name)

        async with self._lock:
            # Find first compatible existing profile
            for slot in self._profiles:
                if slot.is_compatible(merchant, ckey):
                    slot.order_ids.append(order_id)
                    slot.merchant_customers.setdefault(merchant.lower(), set()).add(ckey)
                    logger.info(
                        f"[dolphin] Reusing profile '{slot.profile_name}' "
                        f"for {merchant} / {ckey} "
                        f"(proxy session: {slot.proxy_session_id})"
                    )
                    return slot

            # No compatible profile — create a new one with a fresh proxy + country
            session_id = new_proxy_session_id()
            proxy_country = normalize_region(country)   # e.g. "usa" → "us"
            idx = len(self._profiles) + 1
            profile_name = f"AR_Session{idx}"

            profile_id = await self._create_profile(profile_name, session_id, proxy_country)
            if not profile_id:
                logger.error(f"[dolphin] Could not create profile '{profile_name}' for {merchant}/{ckey}")
                return None

            slot = ProfileSlot(
                profile_id=profile_id,
                profile_name=profile_name,
                proxy_session_id=session_id,
                proxy_country=proxy_country,
                merchant_customers={merchant.lower(): {ckey}},
                order_ids=[order_id],
            )
            self._profiles.append(slot)
            logger.info(
                f"[dolphin] New profile '{profile_name}' "
                f"(proxy={proxy_country}, session={session_id}) "
                f"for {merchant}/{ckey} [{len(self._profiles)} profile(s) active]"
            )
            # Wait for Dolphin local app to sync the newly-created cloud profile
            await self._wait_for_local_sync(profile_id, timeout=45)
            return slot

    async def start_slot(self, slot: ProfileSlot) -> Optional[int]:
        """Start the browser for a slot and cache the CDP port."""
        if slot.cdp_port:
            return slot.cdp_port
        port = await self.start_profile(slot.profile_id)
        if port:
            slot.cdp_port = port
        return port

    async def mark_order_complete(
        self,
        merchant: str,
        order_id: str,
        customer_email: Optional[str] = None,
        customer_name: Optional[str] = None,
    ):
        """
        Mark an order done on its profile slot.
        When all orders on a slot finish, stops and deletes the profile.
        """
        async with self._lock:
            slot = next((s for s in self._profiles if order_id in s.order_ids), None)
            if not slot:
                logger.warning(f"[dolphin] mark_order_complete: order {order_id} not found in any slot")
                return

            slot.completed += 1
            logger.info(
                f"[dolphin] Order {order_id} complete on '{slot.profile_name}' "
                f"({slot.completed}/{len(slot.order_ids)})"
            )
            if slot.completed >= len(slot.order_ids):
                logger.info(f"[dolphin] All orders done — cleaning up '{slot.profile_name}'")
                await self.stop_profile(slot.profile_id)
                await asyncio.sleep(1)
                await self.delete_profile(slot.profile_id)
                self._profiles.remove(slot)

    # ─── Utilities ────────────────────────────────────────────────────────────

    async def close(self):
        if self._local_client:
            await self._local_client.aclose()
            self._local_client = None
        if self._cloud_client:
            await self._cloud_client.aclose()
            self._cloud_client = None

    async def list_all_profiles(self) -> List[dict]:
        await self._ensure_auth()
        try:
            c = await self._cloud()
            r = await c.get("/browser_profiles?limit=100")
            if r.status_code == 200:
                return r.json().get("data", [])
        except Exception as e:
            logger.error(f"[dolphin] list_all_profiles error: {e}")
        return []

    async def delete_autoresolve_profiles(self) -> int:
        """Delete all AR_ profiles (cleanup utility)."""
        profiles = await self.list_all_profiles()
        count = 0
        for p in profiles:
            if p.get("name", "").startswith("AR_"):
                await self.delete_profile(str(p["id"]))
                count += 1
        logger.info(f"[dolphin] Cleanup complete — deleted {count} AutoResolve profile(s)")
        return count

    def profile_summary(self) -> List[dict]:
        """Return a summary of all active profile slots (for logging/debugging)."""
        return [
            {
                "profile_id": slot.profile_id,
                "profile_name": slot.profile_name,
                "proxy_session_id": slot.proxy_session_id,
                "proxy_country": slot.proxy_country,
                "merchants": {m: list(customers) for m, customers in slot.merchant_customers.items()},
                "orders": len(slot.order_ids),
                "completed": slot.completed,
                "active_tabs": slot.active_tabs,
                "cdp_port": slot.cdp_port,
            }
            for slot in self._profiles
        ]


# ─── Singleton ────────────────────────────────────────────────────────────────

_manager: Optional[DolphinManager] = None


def get_dolphin_manager() -> DolphinManager:
    global _manager
    if _manager is None:
        _manager = DolphinManager()
    return _manager
 