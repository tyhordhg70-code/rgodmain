"""
Step1 Return Automation Handler — AutoResolve RDP
Orchestrates browser automation for Step1 (Create Return) orders.

Flow:
1. Fetch order details from API (with retry)
2. Assign / get Dolphin profile slot (new unique proxy session per profile)
3. Open new tab in profile browser
4. Navigate to merchant return portal (with retry on page load)
5. Detect return system & execute return (with retry on failure)
6. Report result via Telegram (with 429 backoff) and API
7. Release profile slot (auto-deletes when all orders done)
"""
import asyncio
import logging
import os
import random
import re
import string
from typing import Dict, List, Optional

import httpx
from playwright.async_api import async_playwright, BrowserContext, Page, TimeoutError as PwTimeout

from dolphin_manager import get_dolphin_manager, ProfileSlot
from return_systems import auto_start_return, OrderInfo
from live_chat import detect_page_language, try_switch_site_language, run_live_chat_flow
from captcha_solver import handle_captcha_page, solve_captcha, detect_and_solve_captcha

logger = logging.getLogger(__name__)

API_BASE = os.environ.get("API_BASE", "https://refundgod.fans/api/retail")
API_KEY = os.environ.get("FORMS_API_KEY", "")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
# Set VERIFY_SSL=0 to skip certificate verification (use while SSL cert is not yet issued)
VERIFY_SSL = os.environ.get("VERIFY_SSL", "1").strip() not in ("0", "false", "no")

# Relay agent (runs on this RDP, bridges captcha → 2captcha and Dolphin API)
RELAY_URL = os.environ.get("RELAY_URL", "http://localhost:4001").rstrip("/")
RELAY_SECRET = os.environ.get("RELAY_SECRET", "")

# ─── Retry helpers ────────────────────────────────────────────────────────────

async def retry_async(coro_fn, label: str, max_attempts: int = 4, base_delay: float = 1.0):
    """Exponential backoff retry. Returns None on exhaustion."""
    for attempt in range(1, max_attempts + 1):
        try:
            return await coro_fn()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 429:
                wait = float(exc.response.headers.get("Retry-After", base_delay * 2 ** attempt))
                logger.warning(f"[{label}] rate-limited (429), waiting {wait:.1f}s (attempt {attempt})")
                await asyncio.sleep(wait)
            elif status >= 500:
                delay = base_delay * (2 ** (attempt - 1))
                logger.warning(f"[{label}] HTTP {status}, retrying in {delay:.1f}s (attempt {attempt})")
                await asyncio.sleep(delay)
            else:
                logger.error(f"[{label}] non-retryable HTTP {status}")
                return None
        except (httpx.ConnectError, httpx.TimeoutException, httpx.RemoteProtocolError) as exc:
            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(f"[{label}] connection error ({exc}), retrying in {delay:.1f}s (attempt {attempt})")
            await asyncio.sleep(delay)
        except Exception as exc:
            logger.error(f"[{label}] unexpected error: {exc}")
            return None
    logger.error(f"[{label}] failed after {max_attempts} attempts")
    return None


# ─── API helpers (with retry) ─────────────────────────────────────────────────

def _api_headers() -> dict:
    h = {}
    if API_KEY:
        h["x-api-key"] = API_KEY
    return h


async def api_get(path: str, max_attempts: int = 4) -> Optional[dict]:
    async def _do():
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15) as c:
            r = await c.get(f"{API_BASE}{path}", headers=_api_headers())
            r.raise_for_status()
            return r.json()
    return await retry_async(_do, f"api_get:{path}", max_attempts=max_attempts)


async def api_patch(path: str, data: dict, max_attempts: int = 4) -> bool:
    async def _do():
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15) as c:
            r = await c.patch(f"{API_BASE}{path}", json=data, headers=_api_headers())
            r.raise_for_status()
            return True
    result = await retry_async(_do, f"api_patch:{path}", max_attempts=max_attempts)
    return result is not None


async def api_post(path: str, data: dict, max_attempts: int = 3) -> Optional[dict]:
    async def _do():
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15) as c:
            r = await c.post(f"{API_BASE}{path}", json=data, headers=_api_headers())
            r.raise_for_status()
            return r.json()
    return await retry_async(_do, f"api_post:{path}", max_attempts=max_attempts)


async def api_post_step(order_id: str, step: str, is_error: bool = False) -> bool:
    async def _do():
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=15) as c:
            r = await c.post(
                f"{API_BASE}/orders/{order_id}/step",
                json={"step": step, "is_error": is_error},
                headers=_api_headers(),
            )
            r.raise_for_status()
            return True
    result = await retry_async(_do, f"api_post_step:{order_id}", max_attempts=3)
    return result is not None


# ─── Telegram send (with 429 backoff) ────────────────────────────────────────

async def send_telegram(chat_id: str, text: str):
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return

    async def _send():
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=10) as c:
            r = await c.post(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            )
            if r.status_code == 429:
                wait = r.json().get("parameters", {}).get("retry_after", 5)
                raise httpx.HTTPStatusError(
                    f"Rate limited", request=r.request, response=r
                )
            r.raise_for_status()
            return True

    await retry_async(_send, "telegram_send", max_attempts=5, base_delay=2.0)


# ─── Telegram document sender ─────────────────────────────────────────────────

async def send_telegram_document(chat_id: str, file_path: str, caption: str = ""):
    """
    Upload a local file to Telegram as a document (PDF, etc.).
    Uses sendDocument multipart API. Retries up to 3 times.
    """
    if not TELEGRAM_BOT_TOKEN or not chat_id:
        return

    async def _send():
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=60) as c:
            with open(file_path, "rb") as fh:
                r = await c.post(
                    f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument",
                    data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
                    files={"document": (os.path.basename(file_path), fh, "application/pdf")},
                )
                if r.status_code == 429:
                    raise httpx.HTTPStatusError("Rate limited", request=r.request, response=r)
                r.raise_for_status()
                return True

    await retry_async(_send, "telegram_send_doc", max_attempts=3, base_delay=2.0)


# ─── Return label grabber ──────────────────────────────────────────────────────

# Selectors for PDF download / print links that appear after return submission.
# Each sub-list groups equivalent ways to trigger the same label download.
_LABEL_SELECTORS = [
    # Direct PDF href
    "a[href$='.pdf']",
    "a[href*='return-label']",
    "a[href*='returnlabel']",
    "a[href*='shipping-label']",
    "a[href*='shippinglabel']",
    # Download attribute links
    "a[download][href*='label']",
    "a[download][href*='pdf']",
    "a[download]",
    # Buttons / links with label-related text
    "button:has-text('Download label')",
    "button:has-text('Download Label')",
    "a:has-text('Download label')",
    "a:has-text('Download Label')",
    "button:has-text('Print label')",
    "button:has-text('Print Label')",
    "a:has-text('Print label')",
    "a:has-text('Print Label')",
    "a:has-text('Print return label')",
    "button:has-text('Download return label')",
    "a:has-text('Download return label')",
    # German
    "a:has-text('Etikett herunterladen')",
    "button:has-text('Etikett herunterladen')",
    "a:has-text('Rücksendeetikett')",
    # French
    "a:has-text('étiquette')",
    "a:has-text('Télécharger')",
    # Italian
    "a:has-text('etichetta')",
    "a:has-text('Scarica')",
    # Spanish
    "a:has-text('etiqueta')",
    "a:has-text('Descargar etiqueta')",
    # Dutch
    "a:has-text('retourlabel')",
    "a:has-text('label downloaden')",
    # Generic
    "[data-testid*='label']",
    "[data-testid*='download']",
    ".return-label a",
    ".shipping-label a",
]


async def grab_return_label_and_send(
    page: Page,
    order_number: str,
    chat_id: str,
    wait_seconds: float = 4.0,
) -> bool:
    """
    After a return is successfully submitted, scan the page for the return label PDF,
    download it, and send it to Telegram as a document.

    Returns True if a label was found and sent, False otherwise.
    """
    import tempfile

    # Give the page a moment to fully render the label/confirmation screen
    await asyncio.sleep(wait_seconds)

    tmp_path = os.path.join(tempfile.gettempdir(), f"return_label_{order_number}.pdf")

    # ── Attempt 1: click a download/print link and capture the download event ──
    for sel in _LABEL_SELECTORS:
        try:
            el = page.locator(sel).first
            if not await el.is_visible(timeout=2000):
                continue

            href = await el.get_attribute("href") or ""

            # If the href is a direct PDF URL, download it via httpx
            if href.lower().endswith(".pdf") or ("label" in href.lower() and "http" in href):
                async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30, follow_redirects=True) as c:
                    resp = await c.get(href)
                    if resp.status_code == 200 and len(resp.content) > 1000:
                        with open(tmp_path, "wb") as f:
                            f.write(resp.content)
                        logger.info(f"[label] Downloaded PDF from href for {order_number}")
                        await send_telegram_document(
                            chat_id, tmp_path,
                            f"📄 Return label — {order_number}",
                        )
                        return True

            async with page.expect_download(timeout=12000) as dl_info:
                await el.click()
            download = await dl_info.value
            await download.save_as(tmp_path)
            logger.info(f"[label] Playwright download captured for {order_number}")
            await send_telegram_document(
                chat_id, tmp_path,
                f"📄 Return label — {order_number}",
            )
            return True

        except Exception:
            continue

    # ── Attempt 2: check current page URL if it looks like a PDF ──────────────
    try:
        current_url = page.url
        if current_url.lower().endswith(".pdf"):
            async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30, follow_redirects=True) as c:
                resp = await c.get(current_url)
                if resp.status_code == 200 and len(resp.content) > 1000:
                    with open(tmp_path, "wb") as f:
                        f.write(resp.content)
                    logger.info(f"[label] Page URL is PDF for {order_number}")
                    await send_telegram_document(
                        chat_id, tmp_path,
                        f"📄 Return label — {order_number}",
                    )
                    return True
    except Exception:
        pass

    logger.info(f"[label] No return label PDF found on page for {order_number}")
    return False


# ─── Photo download (with retry) ─────────────────────────────────────────────

async def download_photos(photo_file_ids: List[str]) -> List[str]:
    """Download photos from Telegram to /tmp, return local paths."""
    import tempfile
    paths = []
    for i, fid in enumerate(photo_file_ids):
        local_path = await retry_async(
            lambda fid=fid, i=i: _download_one_photo(fid, i),
            f"download_photo:{fid[:8]}",
            max_attempts=3,
            base_delay=2.0,
        )
        if local_path:
            paths.append(local_path)
    return paths


async def _download_one_photo(file_id: str, index: int) -> Optional[str]:
    import tempfile
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30) as c:
        r = await c.get(f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getFile?file_id={file_id}")
        r.raise_for_status()
        file_path = r.json().get("result", {}).get("file_path")
        if not file_path:
            return None
        dl = await c.get(f"https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file_path}")
        dl.raise_for_status()
        tmp = os.path.join(tempfile.gettempdir(), f"ar_photo_{index}.jpg")
        with open(tmp, "wb") as f:
            f.write(dl.content)
        logger.info(f"[photos] Downloaded photo {index + 1} → {tmp}")
        return tmp


# ─── Region normalisation ─────────────────────────────────────────────────────

from dolphin_manager import normalize_region  # reuse same map

# ─── Merchant account URLs by region ─────────────────────────────────────────
# Simple merchant → region → url mapping.
# Issue codes (DNA/EB/Step1 etc.) are internal processing labels only —
# the merchant website has no concept of them. All automation starts from
# the account/orders page and navigates from there based on issue type.

MERCHANT_URLS: Dict[str, Dict[str, str]] = {
    "amazon": {
        "us": "https://www.amazon.com/gp/your-account/order-history",
        "gb": "https://www.amazon.co.uk/gp/your-account/order-history",
        "ca": "https://www.amazon.ca/gp/your-account/order-history",
        "au": "https://www.amazon.com.au/gp/your-account/order-history",
        "de": "https://www.amazon.de/gp/your-account/order-history",
        "fr": "https://www.amazon.fr/gp/your-account/order-history",
        "it": "https://www.amazon.it/gp/your-account/order-history",
        "es": "https://www.amazon.es/gp/your-account/order-history",
        "nl": "https://www.amazon.nl/gp/your-account/order-history",
        "jp": "https://www.amazon.co.jp/gp/your-account/order-history",
        "mx": "https://www.amazon.com.mx/gp/your-account/order-history",
        "in": "https://www.amazon.in/gp/your-account/order-history",
    },
    "ebay": {
        "us": "https://www.ebay.com/myb/PurchaseHistory",
        "gb": "https://www.ebay.co.uk/myb/PurchaseHistory",
        "ca": "https://www.ebay.ca/myb/PurchaseHistory",
        "au": "https://www.ebay.com.au/myb/PurchaseHistory",
        "de": "https://www.ebay.de/myb/PurchaseHistory",
        "fr": "https://www.ebay.fr/myb/PurchaseHistory",
        "it": "https://www.ebay.it/myb/PurchaseHistory",
        "es": "https://www.ebay.es/myb/PurchaseHistory",
    },
    "walmart": {
        "us": "https://www.walmart.com/orders",
        "ca": "https://www.walmart.ca/en/account/order-history",
    },
    "best buy": {
        "us": "https://www.bestbuy.com/profile/ss/orders",
        "ca": "https://www.bestbuy.ca/en-ca/account/orders",
    },
    "target":   {"us": "https://www.target.com/account/orders"},
    "costco": {
        "us": "https://www.costco.com/account-management",
        "ca": "https://www.costco.ca/account-management",
        "gb": "https://www.costco.co.uk/account-management",
    },
    "apple": {
        "us": "https://www.apple.com/shop/order/list",
        "gb": "https://www.apple.com/uk/shop/order/list",
        "ca": "https://www.apple.com/ca/shop/order/list",
        "au": "https://www.apple.com/au/shop/order/list",
        "de": "https://www.apple.com/de/shop/order/list",
        "fr": "https://www.apple.com/fr/shop/order/list",
    },
    "samsung": {
        "us": "https://www.samsung.com/us/support/account",
        "gb": "https://www.samsung.com/uk/support/account",
        "ca": "https://www.samsung.com/ca/support/account",
        "au": "https://www.samsung.com/au/support/account",
        "de": "https://www.samsung.com/de/support/account",
    },
    "newegg": {
        "us": "https://www.newegg.com/my/account",
        "ca": "https://www.newegg.ca/my/account",
    },
    "b&h photo":    {"us": "https://www.bhphotovideo.com/c/account"},
    "bhphotovideo": {"us": "https://www.bhphotovideo.com/c/account"},
}

# Domain → 2-letter country code: for URL-based region detection
DOMAIN_REGION_MAP: Dict[str, str] = {
    "amazon.com":    "us",  "amazon.co.uk": "gb",  "amazon.ca":     "ca",
    "amazon.com.au": "au",  "amazon.de":    "de",  "amazon.fr":     "fr",
    "amazon.it":     "it",  "amazon.es":    "es",  "amazon.nl":     "nl",
    "amazon.co.jp":  "jp",  "amazon.com.mx":"mx",  "amazon.in":     "in",
    "ebay.com":      "us",  "ebay.co.uk":   "gb",  "ebay.ca":       "ca",
    "ebay.com.au":   "au",  "ebay.de":      "de",  "ebay.fr":       "fr",
    "ebay.it":       "it",  "ebay.es":      "es",
    "walmart.com":   "us",  "walmart.ca":   "ca",
    "bestbuy.com":   "us",  "bestbuy.ca":   "ca",
    "costco.com":    "us",  "costco.ca":    "ca",  "costco.co.uk":  "gb",
    "newegg.com":    "us",  "newegg.ca":    "ca",
    "samsung.com":   "us",
    "apple.com":     "us",
}

# Country names/labels used in UI selectors (for matching inside dropdowns/menus)
REGION_DISPLAY_NAMES: Dict[str, List[str]] = {
    "us": ["United States", "US", "USA", "America"],
    "gb": ["United Kingdom", "UK", "Great Britain", "England"],
    "ca": ["Canada"],
    "au": ["Australia"],
    "de": ["Germany", "Deutschland"],
    "fr": ["France"],
    "it": ["Italy", "Italia"],
    "es": ["Spain", "España"],
    "nl": ["Netherlands", "Holland"],
    "jp": ["Japan", "日本"],
    "mx": ["Mexico", "México"],
    "in": ["India"],
}


# ─── Customer service / contact URLs (for DNA / LIT / EB orders) ─────────────
# These go straight to live chat or the contact/help centre — NOT to order history.

MERCHANT_CS_URLS: Dict[str, Dict[str, str]] = {
    "amazon": {
        "us": "https://www.amazon.com/gp/help/customer/display.html?nodeId=508510",
        "gb": "https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=508510",
        "ca": "https://www.amazon.ca/gp/help/customer/display.html?nodeId=508510",
        "au": "https://www.amazon.com.au/gp/help/customer/display.html?nodeId=508510",
        "de": "https://www.amazon.de/gp/help/customer/display.html?nodeId=508510",
        "fr": "https://www.amazon.fr/gp/help/customer/display.html?nodeId=508510",
        "it": "https://www.amazon.it/gp/help/customer/display.html?nodeId=508510",
        "es": "https://www.amazon.es/gp/help/customer/display.html?nodeId=508510",
        "nl": "https://www.amazon.nl/gp/help/customer/display.html?nodeId=508510",
        "jp": "https://www.amazon.co.jp/gp/help/customer/display.html?nodeId=508510",
        "mx": "https://www.amazon.com.mx/gp/help/customer/display.html?nodeId=508510",
        "in": "https://www.amazon.in/gp/help/customer/display.html?nodeId=508510",
    },
    "ebay": {
        "us": "https://www.ebay.com/help/home",
        "gb": "https://www.ebay.co.uk/help/home",
        "ca": "https://www.ebay.ca/help/home",
        "au": "https://www.ebay.com.au/help/home",
        "de": "https://www.ebay.de/help/home",
        "fr": "https://www.ebay.fr/help/home",
        "it": "https://www.ebay.it/help/home",
        "es": "https://www.ebay.es/help/home",
    },
    "walmart": {
        "us": "https://www.walmart.com/help",
        "ca": "https://www.walmart.ca/en/help",
    },
    "best buy": {
        "us": "https://www.bestbuy.com/site/help-topics/contact-best-buy/pcmcat318400050001.c",
        "ca": "https://www.bestbuy.ca/en-ca/contact-us",
    },
    "target": {"us": "https://help.target.com/help/subcategoryarticle?childcat=Contact+Us"},
    "costco": {
        "us": "https://customerservice.costco.com/app/contact-us",
        "ca": "https://customerservice.costco.ca/app/contact-us",
        "gb": "https://customerservice.costco.co.uk/app/contact-us",
    },
    "apple": {
        "us": "https://support.apple.com/en-us/contact",
        "gb": "https://support.apple.com/en-gb/contact",
        "ca": "https://support.apple.com/en-ca/contact",
        "au": "https://support.apple.com/en-au/contact",
        "de": "https://support.apple.com/de-de/contact",
        "fr": "https://support.apple.com/fr-fr/contact",
    },
    "samsung": {
        "us": "https://www.samsung.com/us/support/contact/",
        "gb": "https://www.samsung.com/uk/support/contact/",
        "ca": "https://www.samsung.com/ca/support/contact/",
        "au": "https://www.samsung.com/au/support/contact/",
        "de": "https://www.samsung.com/de/support/contact/",
    },
    "newegg": {
        "us": "https://www.newegg.com/Contact",
        "ca": "https://www.newegg.ca/Contact",
    },
    "b&h photo":    {"us": "https://www.bhphotovideo.com/find/HelpCenter.jsp"},
    "bhphotovideo": {"us": "https://www.bhphotovideo.com/find/HelpCenter.jsp"},
}


def get_merchant_url(merchant: str, region: str) -> Optional[str]:
    """Return the account/orders URL for a merchant in the given region. Never cross-region."""
    return MERCHANT_URLS.get(merchant.lower().strip(), {}).get(region)


def get_merchant_cs_url(merchant: str, region: str) -> Optional[str]:
    """
    Return the customer service / contact URL for a merchant in the given region.
    Used for DNA / LIT / EB orders that go directly to live chat.
    Falls back to a Google search for the merchant's contact page.
    """
    url = MERCHANT_CS_URLS.get(merchant.lower().strip(), {}).get(region)
    if url:
        return url
    # Generic fallback: try /contact, /help, /customer-service paths on the merchant domain
    base = MERCHANT_URLS.get(merchant.lower().strip(), {}).get(region)
    if base:
        from urllib.parse import urlparse
        parsed = urlparse(base)
        return f"{parsed.scheme}://{parsed.netloc}/contact"
    return None


def detect_region_from_url(url: str) -> Optional[str]:
    """Detect 2-letter country code from page URL domain or path."""
    try:
        from urllib.parse import urlparse
        hostname = (urlparse(url).hostname or "").removeprefix("www.")
        if hostname in DOMAIN_REGION_MAP:
            return DOMAIN_REGION_MAP[hostname]
        for domain, country in DOMAIN_REGION_MAP.items():
            if hostname.endswith(domain):
                return country
        # Path-based (e.g. apple.com/uk/, samsung.com/gb/)
        path = urlparse(url).path.lower().lstrip("/")
        seg = path.split("/")[0] if "/" in path else path[:2]
        if len(seg) == 2 and seg in DOMAIN_REGION_MAP.values():
            return seg
    except Exception:
        pass
    return None


# ─── OTP / 2FA detection and handling ────────────────────────────────────────

OTP_URL_PATTERNS = (
    "/ap/cvf/",        # Amazon email/SMS verify
    "/ap/dcq/",        # Amazon device confirmation
    "ap/signin",       # Amazon sign-in (may be OTP gate)
    "/challenge",      # Generic challenge pages
    "two-step",        # Generic 2-step verify
    "verify",          # Generic verify pages
    "confirmation",    # Generic confirmation code pages
)

def _is_otp_page(url: str) -> bool:
    """Return True if the current URL looks like an OTP/verification page."""
    url_lower = url.lower()
    return any(p in url_lower for p in OTP_URL_PATTERNS)


async def _extract_otp_destination(page: "Page") -> str:
    """Try to extract the redacted email/phone shown on an OTP page."""
    try:
        # Amazon shows destination in specific elements
        for sel in [
            "[class*='a-color-secondary']",
            "[class*='cvf-widget-input']",
            ".a-color-secondary",
            "span[class*='masked']",
        ]:
            el = page.locator(sel).first
            if await el.is_visible(timeout=2000):
                text = (await el.text_content() or "").strip()
                if text and len(text) < 60:
                    return text
    except Exception:
        pass
    return ""


async def _request_and_wait_for_otp(
    order_id: str,
    merchant: str,
    otp_destination: str,
    chat_id: Optional[str],
    timeout_s: int = 600,
) -> Optional[str]:
    """
    Create an OTP request via the API, notify the customer via the bot,
    then poll until the code is provided or timeout is reached.
    Returns the OTP code string, or None on timeout/failure.
    """
    try:
        # Create OTP request
        r = await api_post("/otp", {
            "order_id": order_id,
            "platform": merchant,
            "otp_destination": otp_destination or None,
            "retry": False,
        })
        if not r or not r.get("id"):
            logger.error(f"[otp] Failed to create OTP request for {order_id}")
            return None

        otp_id = r["id"]
        logger.info(f"[otp] Created OTP request {otp_id} for {order_id}, waiting up to {timeout_s}s...")

        deadline = asyncio.get_event_loop().time() + timeout_s
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(4)
            try:
                data = await api_get(f"/otp/{order_id}")
                if data and data.get("status") == "code_provided" and data.get("code"):
                    logger.info(f"[otp] Code received for order {order_id}")
                    return data["code"]
            except Exception as e:
                logger.debug(f"[otp] Poll error: {e}")

        # Timeout — mark as expired
        logger.warning(f"[otp] Timeout waiting for OTP for order {order_id}")
        await api_patch(f"/otp/{otp_id}", {"bot_status": "expired"})
        return None

    except Exception as e:
        logger.error(f"[otp] _request_and_wait_for_otp error: {e}")
        return None


async def handle_otp_page(
    page: "Page",
    order_id: str,
    merchant: str,
    chat_id: Optional[str],
) -> bool:
    """
    Detect and handle an OTP verification page.
    Returns True if OTP was entered successfully, False otherwise.
    """
    if not _is_otp_page(page.url):
        return False

    logger.info(f"[otp] OTP page detected at {page.url[:80]}")
    destination = await _extract_otp_destination(page)
    if destination:
        logger.info(f"[otp] Destination: {destination}")

    await api_post_step(order_id, f"OTP verification required — waiting for customer code")

    code = await _request_and_wait_for_otp(order_id, merchant, destination, chat_id)
    if not code:
        await api_post_step(order_id, "OTP timeout — no code provided", is_error=True)
        return False

    # Enter the code into the page
    try:
        for sel in [
            "input[type='text']",
            "input[name*='code']",
            "input[name*='otp']",
            "input[id*='otp']",
            "input[id*='code']",
            "input[autocomplete='one-time-code']",
            ".cvf-widget-input input",
        ]:
            inp = page.locator(sel).first
            if await inp.is_visible(timeout=2000):
                await inp.fill(code)
                logger.info(f"[otp] Entered code into {sel}")
                break

        # Submit
        for btn_sel in [
            "input[type='submit']",
            "button[type='submit']",
            "span.a-button-input",
        ]:
            btn = page.locator(btn_sel).first
            if await btn.is_visible(timeout=2000):
                await btn.click()
                logger.info("[otp] Submitted OTP form")
                await page.wait_for_timeout(2000)
                break

        await api_post_step(order_id, f"OTP code entered and submitted")
        return True
    except Exception as e:
        logger.error(f"[otp] Failed to enter code: {e}")
        return False


# ─── Telegram reply polling (for manual region input) ────────────────────────

async def _get_latest_update_id() -> int:
    """Fetch the current highest update_id so we only wait for NEW replies."""
    try:
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=10) as c:
            r = await c.get(
                f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates?limit=1&offset=-1"
            )
            updates = r.json().get("result", [])
            return updates[-1]["update_id"] + 1 if updates else 0
    except Exception:
        return 0


async def _poll_for_reply(from_chat_id: str, after_update_id: int, timeout_s: int = 600) -> Optional[str]:
    """
    Long-poll Telegram until a text message arrives from from_chat_id.
    Returns the message text, or None on timeout.
    """
    offset = after_update_id
    deadline = asyncio.get_event_loop().time() + timeout_s

    while asyncio.get_event_loop().time() < deadline:
        remaining = int(deadline - asyncio.get_event_loop().time())
        wait = min(20, remaining)
        if wait <= 0:
            break
        try:
            async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=wait + 5) as c:
                r = await c.get(
                    f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"
                    f"/getUpdates?offset={offset}&timeout={wait}"
                )
                updates = r.json().get("result", [])
            for upd in updates:
                offset = upd["update_id"] + 1
                msg = upd.get("message", {})
                if str(msg.get("chat", {}).get("id", "")) == str(from_chat_id):
                    text = msg.get("text", "").strip()
                    if text:
                        return text
        except Exception as exc:
            logger.debug(f"[region] Poll error: {exc}")
            await asyncio.sleep(3)

    return None


# ─── Region switching ─────────────────────────────────────────────────────────

async def _try_selector_input(page: Page, hint: str, region: str) -> bool:
    """
    Attempt to use a user-supplied hint to switch region.
    Accepts: URL | CSS selector | plain text (search for clickable element).
    """
    from urllib.parse import urlparse

    # URL hint — navigate directly
    if hint.startswith("http"):
        ok = await navigate_with_retry(page, hint)
        if ok:
            confirmed = detect_region_from_url(page.url)
            return confirmed == region or confirmed is None
        return False

    # CSS selector hint — try clicking it
    if hint.startswith(("#", ".", "[")) or ">" in hint:
        try:
            el = page.locator(hint).first
            if await el.is_visible(timeout=4000):
                await el.click()
                await page.wait_for_timeout(1500)
                # Try to pick the correct country from any opened dropdown/list
                return await _select_country_option(page, region)
        except Exception as exc:
            logger.debug(f"[region] CSS selector hint failed: {exc}")
        return False

    # Plain text — search visible links and buttons for matching text
    try:
        el = page.get_by_text(hint, exact=False).first
        if await el.is_visible(timeout=4000):
            await el.click()
            await page.wait_for_timeout(1500)
            return await _select_country_option(page, region)
    except Exception as exc:
        logger.debug(f"[region] Text hint failed: {exc}")
    return False


async def _select_country_option(page: Page, region: str) -> bool:
    """After opening a region picker, try to click the correct country option."""
    names = REGION_DISPLAY_NAMES.get(region, [region.upper()])
    for name in names:
        for method in [
            lambda n=name: page.get_by_text(n, exact=True).first,
            lambda n=name: page.locator(f"[data-value='{n}']").first,
            lambda n=name: page.locator(f"option:has-text('{n}')").first,
            lambda n=name: page.locator(f"[value='{region.upper()}']").first,
            lambda n=name: page.locator(f"a[href*='/{region}/']").first,
            lambda n=name: page.locator(f"a[href*='={region.upper()}']").first,
        ]:
            try:
                el = method()
                if await el.is_visible(timeout=1500):
                    await el.click()
                    await page.wait_for_timeout(1500)
                    logger.info(f"[region] Selected country option: {name}")
                    return True
            except Exception:
                continue
    return False


async def _try_generic_page_selectors(page: Page, region: str) -> bool:
    """
    Scan the current page for any region/country selector using a broad set of
    generic CSS selectors and text patterns, without being merchant-specific.
    """
    # Generic CSS selectors that commonly wrap region/country pickers
    generic_selectors = [
        # IDs
        "#country-selector", "#region-selector", "#language-selector",
        "#countrySelector", "#regionSelector", "#langSelector",
        "#ship-to", "#delivery-country", "#locale-selector",
        # Classes
        ".country-selector", ".region-selector", ".locale-selector",
        ".country-switcher", ".language-switcher", ".currency-selector",
        # Data attributes
        "[data-country-selector]", "[data-region-selector]",
        "[data-locale-selector]", "[data-testid*='country']",
        "[data-testid*='region']", "[data-automation*='country']",
        # Common aria labels
        "[aria-label*='country' i]", "[aria-label*='region' i]",
        "[aria-label*='language' i]", "[aria-label*='location' i]",
        # Select elements
        "select[name*='country' i]", "select[name*='region' i]",
        "select[id*='country' i]", "select[id*='region' i]",
        # Buttons with common text (English)
        "button:has-text('Ship to')", "button:has-text('Deliver to')",
        "button:has-text('Country')", "button:has-text('Region')",
        "button:has-text('Change country')", "button:has-text('Change region')",
        # German
        "button:has-text('Land')", "button:has-text('Liefern nach')",
        "button:has-text('Land ändern')", "button:has-text('Region ändern')",
        # French
        "button:has-text('Pays')", "button:has-text('Livrer à')",
        "button:has-text('Changer de pays')",
        # Italian
        "button:has-text('Paese')", "button:has-text('Consegna a')",
        "button:has-text('Cambia paese')",
        # Spanish
        "button:has-text('País')", "button:has-text('Enviar a')",
        "button:has-text('Cambiar país')",
        # Dutch
        "button:has-text('Land wijzigen')", "button:has-text('Verzenden naar')",
        # Japanese
        "button:has-text('配送先')", "button:has-text('国')",
        # Portuguese
        "button:has-text('País')", "button:has-text('Alterar país')",
    ]
    for selector in generic_selectors:
        try:
            el = page.locator(selector).first
            if await el.is_visible(timeout=800):
                logger.info(f"[region] Found generic selector: {selector}")
                await el.click()
                await page.wait_for_timeout(1200)
                if await _select_country_option(page, region):
                    return True
                # Dismiss if nothing found
                await page.keyboard.press("Escape")
        except Exception:
            continue

    # Search for text links in footer / header that mention country names
    names = REGION_DISPLAY_NAMES.get(region, [])
    for name in names:
        try:
            el = page.locator(f"footer a:has-text('{name}'), header a:has-text('{name}')").first
            if await el.is_visible(timeout=800):
                logger.info(f"[region] Found region link in page: {name}")
                await el.click()
                await page.wait_for_timeout(1500)
                if detect_region_from_url(page.url) == region:
                    return True
        except Exception:
            continue

    return False


async def _try_google_search(page: Page, merchant: str, region: str) -> bool:
    """Search Google for the merchant's regional site and navigate to it."""
    names = REGION_DISPLAY_NAMES.get(region, [region.upper()])
    query = f"{merchant} {names[0]} site official orders"
    search_url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
    logger.info(f"[region] Trying Google search: {search_url}")

    ok = await navigate_with_retry(page, search_url)
    if not ok:
        return False

    # Click the first result that matches a known regional domain for this merchant
    try:
        links = await page.locator("a[href*='http']").all()
        for link in links[:10]:
            href = await link.get_attribute("href") or ""
            if merchant.lower().split()[0] in href.lower():
                detected = detect_region_from_url(href)
                if detected == region:
                    await link.click()
                    await page.wait_for_timeout(2000)
                    logger.info(f"[region] Navigated via Google result: {href[:80]}")
                    return True
    except Exception as exc:
        logger.debug(f"[region] Google result navigation failed: {exc}")

    return False


async def ensure_merchant_region(
    page: Page,
    merchant: str,
    expected_region: str,
    chat_id: str,
) -> bool:
    """
    Ensure the browser is on the correct regional site for the order.

    Tries in order:
    1. URL domain check — already correct, do nothing
    2. Navigate to known regional URL for this merchant
    3. Generic page selectors (dropdowns, popups, footer links, headers)
    4. Google search for the merchant's regional site
    5. Send Telegram message and WAIT for manual input from the user

    Never silently substitutes a different region.
    """
    # 1. URL check
    detected = detect_region_from_url(page.url)
    if detected == expected_region:
        logger.info(f"[region] {merchant} already on '{expected_region}'")
        return True
    if detected:
        logger.info(f"[region] {merchant} is on '{detected}', need '{expected_region}' — switching")

    # 2. Navigate to known regional URL
    regional_url = get_merchant_url(merchant, expected_region)
    if regional_url:
        logger.info(f"[region] Navigating to regional URL: {regional_url}")
        await navigate_with_retry(page, regional_url)
        if detect_region_from_url(page.url) == expected_region:
            logger.info(f"[region] Confirmed '{expected_region}' after direct navigation")
            return True
        logger.info(f"[region] Site redirected away — trying in-page selectors")

    # 3. Generic in-page selectors (dropdowns, popups, footer, header)
    logger.info(f"[region] Scanning page for region selectors ({merchant})")
    if await _try_generic_page_selectors(page, expected_region):
        logger.info(f"[region] Switched to '{expected_region}' via page selector")
        return True

    # 4. Google search
    logger.info(f"[region] Trying Google search to find {merchant} for region '{expected_region}'")
    if await _try_google_search(page, merchant, expected_region):
        logger.info(f"[region] Found '{expected_region}' site via Google")
        return True

    # 5. Manual input via Telegram — pause and ask the user
    logger.warning(f"[region] All automatic methods failed — requesting manual input via Telegram")
    return await _await_region_input(page, merchant, expected_region, chat_id)


async def _await_region_input(
    page: Page,
    merchant: str,
    expected_region: str,
    chat_id: str,
    timeout_minutes: int = 10,
) -> bool:
    """
    Send a Telegram message asking where the region selector is,
    then wait up to `timeout_minutes` for the user to reply.

    User can reply with:
    - A URL to navigate to
    - A CSS selector (e.g. #country-btn)
    - Text to find on page (e.g. "Ship to United Kingdom")
    - "skip" to proceed without switching
    """
    await send_telegram(
        chat_id,
        f"⚠️ <b>Manual Region Input Required</b>\n\n"
        f"🏪 Merchant: <b>{merchant}</b>\n"
        f"🌍 Target region: {expected_region}\n\n"
        f"All automatic methods failed to find the region/country selector.\n\n"
        f"Please reply with one of:\n"
        f"• A URL to navigate to\n"
        f"• A CSS selector to click\n"
        f"• Text on the page to click\n"
        f"• \"skip\" to continue without switching region\n\n"
        f"Waiting up to {timeout_minutes} minutes…"
    )

    after_id = await _get_latest_update_id()

    while True:
        reply = await _poll_for_reply(chat_id, after_id, timeout_s=timeout_minutes * 60)

        if reply is None:
            await send_telegram(
                chat_id,
                f"⏰ No reply received after {timeout_minutes} min — proceeding without region switch for {merchant}.",
            )
            return False

        if reply.lower() == "skip":
            await send_telegram(chat_id, f"⏭️ Skipping region switch — proceeding with current region.")
            return True

        # Try the user's hint
        logger.info(f"[region] Trying user-supplied hint: {reply!r}")
        success = await _try_selector_input(page, reply, expected_region)
        if success:
            confirmed = detect_region_from_url(page.url)
            await send_telegram(
                chat_id,
                f"✅ Region switched to {expected_region} using your input.\n"
                f"Page is now: {page.url[:80]}",
            )
            return True

        # Hint didn't work — ask again with updated offset
        after_id = await _get_latest_update_id()
        await send_telegram(
            chat_id,
            f"❌ Could not switch region using: {reply}\n\n"
            f"Please try again with a different selector, URL, or type \"skip\".",
        )


# ─── Profile context management ───────────────────────────────────────────────

class ProfileContext:
    def __init__(self, slot: ProfileSlot, context: BrowserContext):
        self.slot = slot
        self.context = context

    async def new_tab(self) -> Page:
        page = await self.context.new_page()
        self.slot.active_tabs += 1
        return page

    async def close_tab(self, page: Page):
        try:
            await page.close()
        except Exception:
            pass
        self.slot.active_tabs = max(0, self.slot.active_tabs - 1)


_live_contexts: Dict[str, ProfileContext] = {}


async def get_or_attach_context(slot: ProfileSlot) -> Optional[ProfileContext]:
    """Connect Playwright to a running Dolphin profile via CDP."""
    if slot.profile_id in _live_contexts:
        return _live_contexts[slot.profile_id]

    mgr = get_dolphin_manager()

    # Retry starting the profile a few times
    port = None
    for attempt in range(1, 4):
        port = await mgr.start_slot(slot)
        if port:
            break
        wait = 3 * attempt
        logger.warning(f"[step1] Could not start profile (attempt {attempt}), waiting {wait}s")
        await asyncio.sleep(wait)

    if not port:
        logger.error(f"[step1] Profile {slot.profile_name} failed to start after retries")
        return None

    # Connect Playwright to CDP
    for attempt in range(1, 4):
        try:
            pw = await async_playwright().start()
            browser = await pw.chromium.connect_over_cdp(f"http://localhost:{port}")
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            pc = ProfileContext(slot, context)
            _live_contexts[slot.profile_id] = pc
            logger.info(f"[step1] Connected to '{slot.profile_name}' on CDP port {port}")
            return pc
        except Exception as exc:
            wait = 2 * attempt
            logger.warning(f"[step1] CDP connect error (attempt {attempt}): {exc}, retrying in {wait}s")
            await asyncio.sleep(wait)

    logger.error(f"[step1] CDP connect failed for {slot.profile_name} after retries")
    return None


# ─── Page navigation with retry ──────────────────────────────────────────────

async def navigate_with_retry(page: Page, url: str, max_attempts: int = 3) -> bool:
    """Navigate to URL, retrying on timeout or network errors."""
    for attempt in range(1, max_attempts + 1):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await page.wait_for_timeout(1500)
            logger.info(f"[step1] Navigated to {url[:60]} (attempt {attempt})")
            return True
        except PwTimeout:
            logger.warning(f"[step1] Page load timeout for {url[:60]} (attempt {attempt})")
        except Exception as exc:
            logger.warning(f"[step1] Navigate error (attempt {attempt}): {exc}")
        if attempt < max_attempts:
            await asyncio.sleep(3 * attempt)
    return False


# ─── Return automation with retry ─────────────────────────────────────────────

async def run_return_with_retry(
    page: Page, order_info: OrderInfo, region: str = "us", max_attempts: int = 2
) -> bool:
    """Run auto_start_return with retry. Re-navigates on retry using the merchant+region URL."""
    return_url = get_merchant_url(order_info.merchant_name, region)

    for attempt in range(1, max_attempts + 1):
        try:
            success = await auto_start_return(page, order_info)
            if success:
                return True
            logger.warning(f"[step1] Return attempt {attempt} returned False for {order_info.order_number}")
        except PwTimeout:
            logger.warning(f"[step1] Return timed out (attempt {attempt}) for {order_info.order_number}")
        except Exception as exc:
            logger.warning(f"[step1] Return error (attempt {attempt}): {exc}")

        if attempt < max_attempts:
            wait = 5 * attempt
            logger.info(f"[step1] Retrying return in {wait}s…")
            await asyncio.sleep(wait)
            # Re-navigate to the return portal
            if return_url:
                await navigate_with_retry(page, return_url)

    return False


# ─── Single order automation ──────────────────────────────────────────────────

async def automate_single_order(order_api: dict) -> bool:
    order_id        = order_api["id"]
    merchant        = order_api["merchant_name"]
    order_number    = order_api["order_number"]
    issue_type      = order_api["issue_type"]
    customer_email  = order_api.get("customer_email")
    customer_name   = order_api.get("customer_name")
    notes           = order_api.get("notes")
    # Extract original issue code from [orig:X] prefix (injected by Telegram parser
    # when the compound Step2+Followup format is used).
    _orig_match     = re.match(r"\[orig:(\w+)\]", notes or "")
    original_issue_type = _orig_match.group(1) if _orig_match else ""
    photo_file_ids  = order_api.get("photo_file_ids") or []
    chat_id         = order_api.get("telegram_chat_id") or TELEGRAM_CHAT_ID
    # Normalise delivery region to 2-letter proxy country code (e.g. "usa" → "us")
    region          = normalize_region(order_api.get("region", "us"))

    # Download photos
    photo_paths: List[str] = []
    if photo_file_ids and TELEGRAM_BOT_TOKEN:
        photo_paths = await download_photos(photo_file_ids)

    # Validate Step1 photos
    store_covers_return = True  # Set False per-merchant if needed
    if issue_type == "Step1" and not store_covers_return and not photo_paths:
        await send_telegram(
            chat_id,
            f"❌ Photos required for Step1 return of {order_number} ({merchant}).\n"
            f"Please resend with photos attached.",
        )
        await api_patch(f"/orders/{order_id}", {"status": "failed"})
        return False

    order_info = OrderInfo(
        order_number=order_number,
        merchant_name=merchant,
        customer_email=customer_email,
        customer_name=customer_name,
        issue_type=issue_type,
        desired_outcome=order_api.get("desired_outcome", "Refund"),
        notes=notes,
        photo_urls=photo_paths,
        store_covers_return=store_covers_return,
        region=region,
    )

    # Get Dolphin profile slot — proxy country is set to the order's delivery region
    mgr = get_dolphin_manager()
    logger.info(f"[step1] Requesting Dolphin slot for {merchant} / {order_id}")
    slot = await mgr.get_or_create_slot(
        merchant, order_id, customer_email, customer_name, country=region
    )
    if not slot:
        logger.error(f"[step1] No Dolphin slot returned for {order_number} ({merchant}) — is Dolphin Anty running?")
        await send_telegram(chat_id, f"❌ Could not open browser for {order_number} ({merchant}).")
        return False

    logger.info(f"[step1] Got slot {slot.profile_name}, attaching Playwright context")
    # Attach Playwright context
    pc = await get_or_attach_context(slot)
    if not pc:
        logger.error(f"[step1] Playwright CDP connect failed for {slot.profile_name}")
        await send_telegram(chat_id, f"❌ Browser connection failed for {order_number} ({merchant}).")
        return False

    page = await pc.new_tab()

    try:
        await api_patch(f"/orders/{order_id}", {"status": "in_progress"})
        await api_post_step(order_id, f"Opening browser — {merchant} #{order_number}")
        await send_telegram(
            chat_id,
            f"🔄 Working on return\n🏪 {merchant} | 📦 {order_number}\n"
            f"🌍 Region: {region} | Proxy: {slot.proxy_country} | Session: {slot.proxy_session_id}",
        )

        # ── Route by issue type ────────────────────────────────────────────────
        #
        # DIRECT TO LIVE CHAT (no return portal):
        #   DNA  — Did Not Arrive       → contact CS, claim package never arrived
        #   LIT  — Lost In Transit      → contact CS, claim lost in transit
        #   EB   — Empty Box            → contact CS, report empty box received
        #   Step2    — Return Not Processed  → contact CS, chase unprocessed return
        #   Followup — Follow-up a case     → live chat with context-aware opening
        #              (original issue code extracted from [orig:X] notes prefix)
        #
        # RETURN PORTAL FIRST, live chat as fallback:
        #   Step1 — Create Return       → try automated return portal; if no portal
        #                                 found or automation fails, fall back to live chat

        # ── Helper: run live chat and report result ────────────────────────────
        async def _run_live_chat(nav_url: Optional[str] = None) -> bool:
            if nav_url:
                await navigate_with_retry(page, nav_url)
            else:
                cs_url = get_merchant_cs_url(merchant, region)
                if cs_url:
                    await navigate_with_retry(page, cs_url)
                else:
                    await navigate_with_retry(
                        page,
                        f"https://www.google.com/search?q={merchant.replace(' ', '+')}+contact+customer+service",
                    )

            detected = await detect_page_language(page, region)
            order_info.page_lang = detected

            await api_post_step(order_id, f"Contacting support via live chat — {issue_type}")
            await send_telegram(
                chat_id,
                f"💬 Contacting support via live chat\n🏪 {merchant} | 📦 {order_number}\n"
                f"Issue: {issue_type} | Page lang: {detected}",
            )

            result = await run_live_chat_flow(
                page=page,
                issue_type=issue_type,
                order_number=order_number,
                customer_email=customer_email or "",
                region=region,
                request_refund=(order_info.desired_outcome == "Refund"),
                original_issue_type=original_issue_type,
            )

            if result["success"]:
                await api_post_step(order_id, f"Live chat contacted — {result['platform']}")
                await send_telegram(
                    chat_id,
                    f"✅ Live chat contacted\n🏪 {merchant} | 📦 {order_number}\n"
                    f"Platform: {result['platform']} | "
                    f"Agent lang: {result['agent_lang']}\n"
                    f"Sent {result['messages_sent']} message(s). Awaiting response.",
                )
            else:
                await api_post_step(order_id, "Live chat unavailable — manual follow-up needed", is_error=True)
                await send_telegram(
                    chat_id,
                    f"❌ Live chat unavailable\n🏪 {merchant} | 📦 {order_number}\n"
                    f"No live chat widget found. Manual follow-up needed.",
                )

            return result["success"]

        # ── Routing ────────────────────────────────────────────────────────────
        if issue_type in ("DNA", "LIT", "EB", "Step2", "Followup"):
            # These go straight to live chat — no return portal involved.
            # Followup orders carry original_issue_type extracted from [orig:X] notes prefix.
            success = await _run_live_chat()

        elif issue_type == "Step1":
            # Try the automated return portal first
            return_url = get_merchant_url(merchant, region)
            if return_url:
                ok = await navigate_with_retry(page, return_url)
                if not ok:
                    raise RuntimeError(f"Could not load return portal for {merchant}/{region}")
            else:
                await navigate_with_retry(
                    page,
                    f"https://www.google.com/search?q={merchant.replace(' ', '+')}+start+return+order",
                )

            # Solve any captcha before proceeding (recaptcha / hcaptcha / turnstile)
            await handle_captcha_page(page, order_id, step_cb=api_post_step)

            # Check for OTP/verification gate before proceeding
            if _is_otp_page(page.url):
                otp_ok = await handle_otp_page(page, order_id, merchant, chat_id)
                if not otp_ok:
                    raise RuntimeError(f"OTP verification failed or timed out for {order_number}")

            # Verify correct region
            await ensure_merchant_region(page, merchant, region, chat_id)

            # Solve captcha again if region switch triggered one
            await handle_captcha_page(page, order_id, step_cb=api_post_step)

            # Check for OTP again after region switch (some sites gate after redirect)
            if _is_otp_page(page.url):
                otp_ok = await handle_otp_page(page, order_id, merchant, chat_id)
                if not otp_ok:
                    raise RuntimeError(f"OTP verification failed after region switch for {order_number}")

            # Detect and align page language
            detected_lang = await detect_page_language(page, region)
            import locale_strings as _L
            region_lang = _L.get_lang(region)

            if detected_lang != region_lang:
                logger.info(
                    f"[step1] Page lang '{detected_lang}' differs from region lang "
                    f"'{region_lang}' — trying site language switch"
                )
                switched = await try_switch_site_language(page, region_lang)
                if switched:
                    detected_lang = await detect_page_language(page, region)
                    logger.info(f"[step1] Post-switch detected lang='{detected_lang}'")

            order_info.page_lang = detected_lang

            # Run the return portal automation
            success = await run_return_with_retry(page, order_info, region=region, max_attempts=2)

            if success:
                label_sent = await grab_return_label_and_send(page, order_number, chat_id)
                await api_post_step(order_id, "Return completed successfully")
                await send_telegram(
                    chat_id,
                    f"✅ Return Completed\n🏪 {merchant} | 📦 {order_number}\n"
                    + (
                        "Return label sent above."
                        if label_sent
                        else "Return submitted. No downloadable label found on page."
                    ),
                )
            else:
                # Portal failed — fall back to live chat
                logger.info(
                    f"[step1] Return portal failed for {order_number} — falling back to live chat"
                )
                await send_telegram(
                    chat_id,
                    f"⚠️ Return portal not found — trying live chat for {order_number} ({merchant})…",
                )
                await api_post_step(order_id, "Return portal failed — falling back to live chat")
                success = await _run_live_chat()

        else:
            logger.warning(f"[step1] Unknown issue_type '{issue_type}' for order {order_number}")
            await api_post_step(order_id, f"Unknown issue type: {issue_type}", is_error=True)
            await send_telegram(
                chat_id,
                f"⚠️ Unknown issue type {issue_type} for {order_number} ({merchant})\n"
                f"Skipping — manual review needed.",
            )
            success = False

        status = "resolved" if success else "failed"
        await api_patch(f"/orders/{order_id}", {"status": status})
        await api_post_step(order_id, f"Order {status}")

        return success

    except Exception as exc:
        logger.error(f"[step1] Automation error for {order_number}: {exc}")
        await api_patch(f"/orders/{order_id}", {"status": "failed"})
        await api_post_step(order_id, f"Automation error: {str(exc)[:80]}", is_error=True)
        await send_telegram(
            chat_id,
            f"❌ Error during return\n🏪 {merchant} | 📦 {order_number}\n{str(exc)[:120]}",
        )
        return False

    finally:
        await pc.close_tab(page)
        await mgr.mark_order_complete(merchant, order_id, customer_email, customer_name)


# ─── Bulk order processing ────────────────────────────────────────────────────

async def automate_orders(order_ids: List[str]):
    """
    Process multiple orders in parallel.
    Each distinct (merchant, customer) pair gets its own Dolphin profile + unique proxy.
    """
    # Fetch all orders (with retry)
    orders = []
    fetch_tasks = [api_get(f"/orders/{oid}") for oid in order_ids]
    results = await asyncio.gather(*fetch_tasks, return_exceptions=True)
    for oid, result in zip(order_ids, results):
        if isinstance(result, dict) and result:
            orders.append(result)
        else:
            logger.warning(f"[step1] Could not fetch order {oid}: {result}")

    if not orders:
        logger.error("[step1] No valid orders to process")
        raise RuntimeError("No valid orders could be fetched — all will be rolled back to pending")

    logger.info(f"[step1] Processing {len(orders)} order(s) in parallel")

    automation_results = await asyncio.gather(
        *[automate_single_order(o) for o in orders],
        return_exceptions=True,
    )

    succeeded = 0
    failed = 0
    for order, result in zip(orders, automation_results):
        oid = order.get("id", "?")
        if result is True:
            succeeded += 1
        elif isinstance(result, Exception):
            failed += 1
            logger.error(f"[step1] Order {oid} failed with exception: {type(result).__name__}: {result}")
        else:
            failed += 1
            logger.warning(f"[step1] Order {oid} returned unexpected result: {result!r}")
    logger.info(f"[step1] Batch complete — {succeeded} succeeded, {failed} failed")


# ─── Entry point ──────────────────────────────────────────────────────────────

async def handle_automation_trigger(order_ids: List[str]):
    """Called by the RDP Telegram bot when automation is triggered."""
    await automate_orders(order_ids)


if __name__ == "__main__":
    import sys
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    ids = sys.argv[1:]
    if not ids:
        print("Usage: python step1_handler.py ORDER_UUID_1 [ORDER_UUID_2 ...]")
        sys.exit(1)
    asyncio.run(handle_automation_trigger(ids))
