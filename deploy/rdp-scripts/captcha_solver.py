"""
Captcha Solver — AutoResolve RDP

Detects and solves captchas on Playwright pages via the local relay agent
which proxies to 2captcha.  Call from any automation script without circular
import issues (this module has no AutoResolve-specific dependencies).

Usage:
    from captcha_solver import handle_captcha_page, solve_captcha

    # Quick single-call approach (detects + solves + submits):
    solved = await handle_captcha_page(page, order_id=order_id, step_cb=api_post_step)

    # Low-level: solve a specific captcha type:
    token = await solve_captcha("recaptchav2", sitekey="6Le...", pageurl="https://...")
"""
import asyncio
import logging
import os
from typing import Callable, Coroutine, Optional

import httpx

logger = logging.getLogger(__name__)

RELAY_URL = os.environ.get("RELAY_URL", "http://localhost:4001").rstrip("/")
RELAY_SECRET = os.environ.get("RELAY_SECRET", "")


# ─── Relay communication ──────────────────────────────────────────────────────

async def _relay_post(path: str, body: dict) -> Optional[dict]:
    """POST to the local relay agent."""
    headers: dict = {"Content-Type": "application/json"}
    if RELAY_SECRET:
        headers["x-relay-secret"] = RELAY_SECRET
    try:
        async with httpx.AsyncClient(timeout=150) as c:  # 2min+ for solving
            r = await c.post(f"{RELAY_URL}{path}", json=body, headers=headers)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.error(f"[captcha] relay request failed: {e}")
        return None


# ─── 2captcha solve ───────────────────────────────────────────────────────────

async def solve_captcha(captcha_type: str, **kwargs) -> Optional[str]:
    """
    Solve a captcha via relay → 2captcha.
    Returns the solved token string, or None on failure.

    Supported types and required kwargs
    ────────────────────────────────────
    recaptchav2  sitekey, pageurl  [invisible, enterprise, data_s]
    recaptchav3  sitekey, pageurl  [action, min_score, enterprise]
    hcaptcha     sitekey, pageurl  [invisible]
    turnstile    sitekey, pageurl  [action, cdata]
    amazon_waf   sitekey, iv, context, pageurl
    datadome     captcha_url, pageurl, userAgent  [proxy, proxytype]
    funcaptcha   publickey, pageurl  [surl, data]
    geetest      gt, challenge, pageurl
    temu         app_id, nonce, pageurl  [userAgent]
    image        body (base64)  [hint, phrase, case, numeric]
    """
    if not RELAY_URL:
        logger.warning("[captcha] RELAY_URL not configured — captcha solving disabled")
        return None

    payload = {"type": captcha_type, **kwargs}
    logger.info(f"[captcha] Submitting {captcha_type} to 2captcha via relay…")
    result = await _relay_post("/captcha/solve", payload)
    if result and result.get("result"):
        token = str(result["result"])
        logger.info(f"[captcha] Solved {captcha_type} — token prefix: {token[:30]}…")
        return token

    logger.error(f"[captcha] Solve failed — relay response: {result}")
    return None


async def check_captcha_balance() -> Optional[float]:
    """Return the 2captcha account balance, or None on failure."""
    result = await _relay_post("/captcha/solve", {"type": "balance"})
    if result and "balance" in result:
        bal = float(result["balance"])
        logger.info(f"[captcha] 2captcha balance: ${bal:.2f}")
        return bal
    return None


# ─── Page-level detection & injection ────────────────────────────────────────

async def detect_and_solve_captcha(page) -> bool:
    """
    Inspect the current Playwright page for common captcha widgets,
    solve via 2captcha, inject the response token, and return True
    if a captcha was found and solved.  Returns False if no captcha
    was present.
    """
    url = page.url

    # ── reCaptcha v2 ──────────────────────────────────────────────────────────
    try:
        rc_count = await page.locator("iframe[src*='recaptcha/api']").count()
        if rc_count:
            sitekey = await page.locator("[data-sitekey]").first.get_attribute(
                "data-sitekey", timeout=3000
            )
            if sitekey:
                logger.info(f"[captcha] reCaptcha v2 detected, sitekey={sitekey[:20]}…")
                token = await solve_captcha("recaptchav2", sitekey=sitekey, pageurl=url)
                if token:
                    await page.evaluate(
                        """(tok) => {
                          const targets = [
                            document.querySelector('[name="g-recaptcha-response"]'),
                            document.getElementById('g-recaptcha-response'),
                          ];
                          targets.filter(Boolean).forEach(el => { el.innerHTML = tok; el.value = tok; });
                        }""",
                        token,
                    )
                    await page.wait_for_timeout(1500)
                    return True
    except Exception as exc:
        logger.debug(f"[captcha] reCaptcha v2 check error: {exc}")

    # ── hCaptcha ──────────────────────────────────────────────────────────────
    try:
        hc_count = await page.locator("iframe[src*='hcaptcha']").count()
        if hc_count:
            sitekey = await page.locator(
                "[data-hcaptcha-widget-id],[data-sitekey]"
            ).first.get_attribute("data-sitekey", timeout=3000)
            if sitekey:
                logger.info(f"[captcha] hCaptcha detected, sitekey={sitekey[:20]}…")
                token = await solve_captcha("hcaptcha", sitekey=sitekey, pageurl=url)
                if token:
                    await page.evaluate(
                        """(tok) => {
                          const el = document.querySelector('[name="h-captcha-response"]');
                          if (el) { el.innerHTML = tok; el.value = tok; }
                        }""",
                        token,
                    )
                    await page.wait_for_timeout(1500)
                    return True
    except Exception as exc:
        logger.debug(f"[captcha] hCaptcha check error: {exc}")

    # ── Cloudflare Turnstile ──────────────────────────────────────────────────
    try:
        ts_count = await page.locator("iframe[src*='turnstile'],.cf-turnstile").count()
        if ts_count:
            sitekey = await page.locator(
                ".cf-turnstile,[data-sitekey]"
            ).first.get_attribute("data-sitekey", timeout=3000)
            if sitekey:
                logger.info(f"[captcha] Turnstile detected, sitekey={sitekey[:20]}…")
                token = await solve_captcha("turnstile", sitekey=sitekey, pageurl=url)
                if token:
                    await page.evaluate(
                        """(tok) => {
                          const inp = document.querySelector('[name="cf-turnstile-response"]');
                          if (inp) { inp.value = tok; }
                        }""",
                        token,
                    )
                    await page.wait_for_timeout(1500)
                    return True
    except Exception as exc:
        logger.debug(f"[captcha] Turnstile check error: {exc}")

    # ── Amazon WAF / PerimeterX ───────────────────────────────────────────────
    try:
        content = await page.content()
        if "PerimeterX" in content or "px-captcha" in content or "aws-waf-token" in content:
            waf_key = await page.locator("[data-site-key]").first.get_attribute(
                "data-site-key", timeout=2000
            )
            if waf_key:
                iv = await page.locator("[name='iv'],[data-iv]").first.get_attribute(
                    "value", timeout=2000
                ) or await page.locator("[data-iv]").first.get_attribute("data-iv", timeout=2000)
                ctx = await page.locator("[name='context'],[data-context]").first.get_attribute(
                    "value", timeout=2000
                ) or await page.locator("[data-context]").first.get_attribute("data-context", timeout=2000)
                if iv and ctx:
                    logger.info("[captcha] Amazon WAF captcha detected")
                    token = await solve_captcha(
                        "amazon_waf", sitekey=waf_key, iv=iv, context=ctx, pageurl=url
                    )
                    if token:
                        await page.evaluate(
                            "(tok) => { const a = document.getElementById('captchaAnswer'); if (a) a.value = tok; }",
                            token,
                        )
                        await page.wait_for_timeout(1500)
                        return True
    except Exception as exc:
        logger.debug(f"[captcha] Amazon WAF check error: {exc}")

    # ── Temu ─────────────────────────────────────────────────────────────────
    # Temu embeds app_id + a per-challenge nonce in the page's JS context.
    # The captcha overlay uses data-app-id / data-nonce attributes or window vars.
    try:
        temu_present = await page.locator(
            "[class*='captcha'],[id*='captcha'],[data-app-id],[data-nonce]"
        ).count()
        if temu_present == 0 and "temu.com" not in url:
            raise StopIteration  # skip Temu block entirely for non-Temu pages

        # Pull app_id and nonce from DOM attributes or window JS variables
        temu_data = await page.evaluate("""() => {
            // Try DOM attributes first (most reliable)
            const el = document.querySelector('[data-app-id]') ||
                       document.querySelector('[data-nonce]');
            if (el) {
                return {
                    app_id: el.getAttribute('data-app-id') || '',
                    nonce:  el.getAttribute('data-nonce')  || '',
                };
            }
            // Fallback: some Temu pages expose these on window
            return {
                app_id: (window.__TEMU_CAPTCHA__ || {}).appId  || window.temuAppId  || '',
                nonce:  (window.__TEMU_CAPTCHA__ || {}).nonce  || window.temuNonce  || '',
            };
        }""")

        app_id = (temu_data or {}).get("app_id", "")
        nonce  = (temu_data or {}).get("nonce", "")
        user_agent = await page.evaluate("() => navigator.userAgent")

        if app_id and nonce:
            logger.info(f"[captcha] Temu captcha detected, app_id={app_id}")
            token = await solve_captcha(
                "temu", app_id=app_id, nonce=nonce, pageurl=url, userAgent=user_agent
            )
            if token:
                # Inject the solved token and trigger Temu's internal verification handler
                await page.evaluate(
                    """(tok) => {
                        // Store in expected window variable
                        if (window.__TEMU_CAPTCHA__) {
                            window.__TEMU_CAPTCHA__.token = tok;
                        }
                        // Try to call the global captcha success callback if it exists
                        if (typeof window.onTemuCaptchaSuccess === 'function') {
                            window.onTemuCaptchaSuccess(tok);
                        }
                        // Some versions read from a hidden input
                        const inp = document.querySelector('[name="captcha_token"],[name="temu_captcha"]');
                        if (inp) inp.value = tok;
                    }""",
                    token,
                )
                await page.wait_for_timeout(2000)
                return True
    except StopIteration:
        pass
    except Exception as exc:
        logger.debug(f"[captcha] Temu check error: {exc}")

    return False


# ─── High-level helper for automation flows ───────────────────────────────────

async def handle_captcha_page(
    page,
    order_id: str = "",
    max_attempts: int = 2,
    step_cb: Optional[Callable[..., Coroutine]] = None,
) -> bool:
    """
    Detect, solve, and submit any captcha on the page.
    Retries up to *max_attempts* times (in case captcha reloads).

    Parameters
    ──────────
    page         Playwright Page object
    order_id     Order ID for step logging (optional)
    max_attempts Max solve+submit cycles before giving up
    step_cb      Async callable(order_id, message, *, is_error=False) for step logging

    Returns True if captcha was solved or none was present, False on failure.
    """
    for attempt in range(1, max_attempts + 1):
        solved = await detect_and_solve_captcha(page)
        if not solved:
            return True  # No captcha on this page — proceed normally

        # Attempt to click the submit button after injecting token
        for sel in ["[type='submit']", "button[data-action='submit']", "input[type='submit']", "button[type='submit']"]:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1500):
                    await btn.click()
                    await page.wait_for_timeout(2000)
                    break
            except Exception:
                pass

        # Check if captcha disappeared
        still_blocked = await page.locator(
            "iframe[src*='recaptcha'],iframe[src*='hcaptcha'],iframe[src*='turnstile'],.cf-turnstile"
        ).count()
        if not still_blocked:
            if step_cb and order_id:
                await step_cb(order_id, "Captcha solved — page submitted")
            return True

        logger.warning(f"[captcha] Captcha reappeared after solve (attempt {attempt}/{max_attempts})")

    logger.error(f"[captcha] Could not clear captcha after {max_attempts} attempts on {page.url}")
    if step_cb and order_id:
        await step_cb(order_id, "Captcha solve failed — page still blocked", is_error=True)
    return False
