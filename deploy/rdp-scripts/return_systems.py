"""
Return System Navigation — AutoResolve RDP
Handles Step1 (Create Return) across all major return portals.

Supported systems:
  Loop Returns, Narvar, AfterShip Returns, Returnly, Happy Returns,
  Rich Returns, ReturnGo, ClaimLane, ClickPost, Ingrid, Zigzag, Aftercare, Shopify native

Multi-language support:
  Button text selectors and return reasons are resolved through locale_strings.py,
  which provides localized variants for each supported region language.
  English is always tried as a final fallback.
"""
import asyncio
import logging
import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional

from playwright.async_api import Page

import locale_strings as L
from captcha_solver import handle_captcha_page

logger = logging.getLogger(__name__)


# ─── Order data ───────────────────────────────────────────────────────────────

@dataclass
class OrderInfo:
    order_number: str
    merchant_name: str
    customer_email: Optional[str]
    customer_name: Optional[str]
    issue_type: str                   # Step1, DNA, EB, etc.
    desired_outcome: str              # Refund / Replacement
    notes: Optional[str]
    photo_urls: List[str]             # Local photo paths (already downloaded)
    store_covers_return: bool = True  # If False → reason must be "damaged"
    region: str = "us"                # 2-letter region code — used for proxy/context
    page_lang: str = ""               # Detected page UI language (ISO 639-1).
                                      # When set, overrides region-derived language for
                                      # all button text and reason matching.

    @property
    def lang(self) -> str:
        """
        Effective language to use for UI interaction.
        If page_lang is detected (e.g. 'de', 'fr') it takes priority over the
        region-derived language, so the bot interacts in the language the page
        is actually displaying — regardless of what region the order ships to.
        Falls back to the region-derived language, then to 'en'.
        """
        if self.page_lang:
            return self.page_lang
        return L.get_lang(self.region)


# ─── Return reason helpers ────────────────────────────────────────────────────

def choose_return_reason_texts(order: OrderInfo) -> List[str]:
    """
    Return a prioritised list of localized reason text variants for the order.
    Uses the detected page language (order.lang) so reasons match what the
    portal is actually showing, not just what the region language predicts.
    """
    return L.reason_texts(order.lang, order.issue_type, order.store_covers_return)


def choose_return_reason(order: OrderInfo) -> str:
    """Return the single best-fit reason string for the order (localized first choice)."""
    return choose_return_reason_texts(order)[0]


# ─── Base class ───────────────────────────────────────────────────────────────

class ReturnSystem(ABC):
    name: str = "Unknown"
    url_patterns: List[str] = []

    @classmethod
    def matches(cls, url: str) -> bool:
        return any(p in url for p in cls.url_patterns)

    @abstractmethod
    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        """Navigate the return portal and submit the return. Returns True on success."""
        ...

    # ── Low-level helpers ─────────────────────────────────────────

    async def _find_and_click(self, page: Page, selectors: List[str], label: str = "") -> bool:
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    await loc.click()
                    logger.info(f"[{self.name}] Clicked {label or sel}")
                    return True
            except Exception:
                continue
        logger.warning(f"[{self.name}] Could not click {label}")
        return False

    async def _fill_field(self, page: Page, selectors: List[str], value: str) -> bool:
        for sel in selectors:
            try:
                loc = page.locator(sel).first
                if await loc.count() > 0:
                    await loc.fill(value)
                    return True
            except Exception:
                continue
        return False

    async def _select_option_containing(self, page: Page, select_sel: str, text: str) -> bool:
        try:
            await page.select_option(select_sel, label=re.compile(text, re.IGNORECASE))
            return True
        except Exception:
            pass
        try:
            loc = page.get_by_text(re.compile(text, re.IGNORECASE)).first
            if await loc.count() > 0:
                await loc.click()
                return True
        except Exception:
            pass
        return False

    async def _upload_photos(self, page: Page, photo_paths: List[str],
                              input_sel: str = "input[type=file]",
                              region: str = "us") -> bool:
        if not photo_paths:
            return True
        try:
            file_input = page.locator(input_sel).first
            if await file_input.count() == 0:
                # Try to trigger file picker via localized button text
                upload_pattern = L.upload_pattern(region)
                await page.get_by_text(
                    re.compile(upload_pattern, re.IGNORECASE)
                ).first.click()
                await page.wait_for_timeout(500)
                file_input = page.locator(input_sel).first
            await file_input.set_input_files(photo_paths)
            await page.wait_for_timeout(1000)
            logger.info(f"[{self.name}] Uploaded {len(photo_paths)} photo(s)")
            return True
        except Exception as e:
            logger.error(f"[{self.name}] Photo upload error: {e}")
            return False

    # ── Localized helpers ──────────────────────────────────────────

    def _btn(self, region: str, key: str, extra_css: List[str] = None) -> List[str]:
        """
        Build a list of Playwright CSS selectors for a localized button key.
        Localized button:has-text() first, then English fallbacks, then extra_css.
        """
        return L.btn_selectors(region, key, extra_css)

    async def _click_localized(self, page: Page, region: str, key: str,
                                extra_css: List[str] = None, label: str = "") -> bool:
        """Click the first visible button matching the localized label key."""
        selectors = self._btn(region, key, extra_css)
        return await self._find_and_click(page, selectors, label or key)

    async def _select_reason(self, page: Page, order: OrderInfo,
                              select_sels: List[str] = None) -> bool:
        """
        Try to select/click the correct return reason in any visible dropdown or radio.
        Tries each localized reason variant in priority order across all provided selectors.
        """
        reason_variants = choose_return_reason_texts(order)
        selectors = select_sels or ["[name*=reason]", "[name=reason]", "select"]

        for reason_text in reason_variants:
            for sel in selectors:
                ok = await self._select_option_containing(page, sel, reason_text[:25])
                if ok:
                    logger.info(f"[{self.name}] Selected reason: {reason_text!r}")
                    return True

        # Last resort: try data-reason attribute with key word
        rkey = L.reason_key(order.issue_type, order.store_covers_return)
        for attr_val in ["damaged", "defective", "never_arrived", "not_received", rkey]:
            try:
                loc = page.locator(f"[data-reason*='{attr_val}']").first
                if await loc.count() > 0:
                    await loc.click()
                    logger.info(f"[{self.name}] Selected reason via data-reason: {attr_val}")
                    return True
            except Exception:
                continue

        logger.warning(f"[{self.name}] Could not select return reason")
        return False


# ─── Loop Returns ─────────────────────────────────────────────────────────────

class LoopReturns(ReturnSystem):
    name = "Loop Returns"
    url_patterns = ["loopreturnscenter.com", "loop-return", "loopreturns.com"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        logger.info(f"[Loop] Starting return for {order.order_number} (region={r})")
        try:
            await self._fill_field(page,
                ["#order-number", "[name=orderNumber]", "[placeholder*=order]"],
                order.order_number)
            await self._fill_field(page,
                ["#email", "[name=email]", "[type=email]"],
                order.customer_email or "")
            await self._find_and_click(page,
                ["button[type=submit]", "#start-return", "[data-testid=start]"], "submit")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                ["[data-testid=item-checkbox]", ".item-select input", ".return-item"], "select item")
            await page.wait_for_timeout(500)
            await self._click_localized(page, r, "btn_next",
                extra_css=["#next-btn", "[type=submit]"], label="next")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["[name=reason]", "select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit",
                extra_css=["#submit-return"], label="submit")
            await page.wait_for_timeout(2000)
            logger.info(f"[Loop] Return submitted for {order.order_number}")
            return True
        except Exception as e:
            logger.error(f"[Loop] Error: {e}")
            return False


# ─── Narvar Returns ───────────────────────────────────────────────────────────

class NarvarReturns(ReturnSystem):
    name = "Narvar Returns"
    url_patterns = ["returns.narvar.com", "narvar.com/return"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        logger.info(f"[Narvar] Starting return for {order.order_number} (region={r})")
        try:
            await self._fill_field(page,
                ["#order_number", "[name=order_id]", "[placeholder*=order]"],
                order.order_number)
            await self._fill_field(page,
                ["#email", "[name=email]", "[type=email]"],
                order.customer_email or "")
            await self._click_localized(page, r, "btn_find",
                extra_css=["[type=submit]"], label="find order")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                [".select-all", "input[id*=select-all]", "[data-testid=select-all]"], "select all")
            await page.wait_for_timeout(500)

            await self._select_reason(page, order, ["select[name*=reason]", "select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_continue",
                extra_css=["[type=submit]"], label="continue")
            await page.wait_for_timeout(2000)

            await self._click_localized(page, r, "btn_confirm",
                extra_css=["[data-testid=confirm]"], label="confirm")
            await page.wait_for_timeout(1500)
            logger.info(f"[Narvar] Return submitted for {order.order_number}")
            return True
        except Exception as e:
            logger.error(f"[Narvar] Error: {e}")
            return False


# ─── AfterShip Returns ────────────────────────────────────────────────────────

class AfterShipReturns(ReturnSystem):
    name = "AfterShip Returns"
    url_patterns = ["returns.aftership.com", "aftership.com/return"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        logger.info(f"[AfterShip] Starting return for {order.order_number} (region={r})")
        try:
            await self._fill_field(page,
                ["[name=orderNumber]", "#order-number", "[placeholder*=Order]"],
                order.order_number)
            await self._fill_field(page, ["[name=email]", "#email"], order.customer_email or "")
            await self._click_localized(page, r, "btn_start_return",
                extra_css=["[type=submit]"], label="start")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                ["[data-testid*=item]", ".return-item-card", "input[type=checkbox]"], "select item")
            await page.wait_for_timeout(500)
            await self._click_localized(page, r, "btn_next",
                extra_css=["[data-testid=next]"], label="next")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["[name=returnReason]", "select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit",
                extra_css=["[type=submit]"], label="submit")
            await page.wait_for_timeout(2000)
            logger.info(f"[AfterShip] Return submitted for {order.order_number}")
            return True
        except Exception as e:
            logger.error(f"[AfterShip] Error: {e}")
            return False


# ─── Returnly ─────────────────────────────────────────────────────────────────

class ReturnlySystem(ReturnSystem):
    name = "Returnly"
    url_patterns = ["returnly.com", "returns.returnly.com"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["#order_name", "[placeholder*='Order #']"], order.order_number)
            await self._fill_field(page, ["#email"], order.customer_email or "")
            await self._click_localized(page, r, "btn_continue",
                extra_css=["[type=submit]"], label="submit")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                [".item-checkbox", "input[type=checkbox]"], "select item")
            await self._click_localized(page, r, "btn_next", label="next")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit", label="submit")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[Returnly] Error: {e}")
            return False


# ─── Happy Returns ────────────────────────────────────────────────────────────

class HappyReturns(ReturnSystem):
    name = "Happy Returns"
    url_patterns = ["happyreturns.com", "returns.happyreturns.com"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[data-testid=order-number]", "#orderId", "[name=orderId]"], order.order_number)
            await self._fill_field(page,
                ["[data-testid=email]", "#email", "[name=email]"], order.customer_email or "")
            await self._click_localized(page, r, "btn_start_return",
                extra_css=["[data-testid=submit]"], label="start")
            await page.wait_for_timeout(2500)

            await self._find_and_click(page,
                ["[data-testid*=item]", ".item-card button"], "select item")
            await page.wait_for_timeout(500)

            await self._select_reason(page, order, ["select[data-testid*=reason]", "select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_continue",
                extra_css=["[data-testid=continue]"], label="continue")
            await page.wait_for_timeout(2000)

            await self._click_localized(page, r, "btn_mail_in",
                extra_css=["[data-testid=mail-in]"], label="mail-in")
            await page.wait_for_timeout(1000)
            await self._click_localized(page, r, "btn_confirm",
                extra_css=["[data-testid=confirm]"], label="confirm")
            await page.wait_for_timeout(2000)
            logger.info(f"[Happy Returns] Return submitted")
            return True
        except Exception as e:
            logger.error(f"[Happy Returns] Error: {e}")
            return False


# ─── Rich Returns ─────────────────────────────────────────────────────────────

class RichReturns(ReturnSystem):
    name = "Rich Returns"
    url_patterns = ["richreturns.io", "returns.richreturns.io"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[name=order_number]", "#order_id"], order.order_number)
            await self._fill_field(page, ["[name=email]", "#email"], order.customer_email or "")
            await self._click_localized(page, r, "btn_next",
                extra_css=["[type=submit]"], label="submit")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                ["input[type=checkbox]", ".item-row"], "select item")
            await page.wait_for_timeout(500)
            await self._click_localized(page, r, "btn_next", label="next")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["select[name*=reason]", "select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit", label="submit")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[Rich Returns] Error: {e}")
            return False


# ─── ReturnGo ─────────────────────────────────────────────────────────────────

class ReturnGo(ReturnSystem):
    name = "ReturnGo"
    url_patterns = ["returngo.ai", "returns.returngo.ai"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[placeholder*=order]", "[name=order]"], order.order_number)
            await self._fill_field(page,
                ["[type=email]", "[name=email]"], order.customer_email or "")
            await self._click_localized(page, r, "btn_find",
                extra_css=["[type=submit]"], label="find")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                ["[class*=item] input[type=checkbox]", ".product-item"], "select")
            await self._click_localized(page, r, "btn_start_return", label="return selected")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit", label="submit")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[ReturnGo] Error: {e}")
            return False


# ─── ClaimLane ────────────────────────────────────────────────────────────────

class ClaimLane(ReturnSystem):
    name = "ClaimLane"
    url_patterns = ["claimlane.com"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[name=orderNumber]", "[placeholder*=order]"], order.order_number)
            await self._fill_field(page,
                ["[name=email]", "[type=email]"], order.customer_email or "")
            await self._find_and_click(page, ["button[type=submit]"], "submit")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page, ["input[type=checkbox]"], "select")
            await self._click_localized(page, r, "btn_continue",
                extra_css=["[type=submit]"], label="continue")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit", label="submit")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[ClaimLane] Error: {e}")
            return False


# ─── ClickPost Returns ────────────────────────────────────────────────────────

class ClickPostReturns(ReturnSystem):
    name = "ClickPost Returns"
    url_patterns = ["clickpost.ai/return", "clickpost.in/return"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[name=awb]", "[placeholder*=AWB]", "[name=order_id]"], order.order_number)
            await self._fill_field(page,
                ["[name=email]", "[type=email]"], order.customer_email or "")
            await self._click_localized(page, r, "btn_find",
                extra_css=["button[type=submit]"], label="submit")
            await page.wait_for_timeout(2000)

            await self._click_localized(page, r, "btn_return",
                extra_css=[".return-btn"], label="return btn")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["select[name*=reason]", "select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit", label="submit")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[ClickPost] Error: {e}")
            return False


# ─── Ingrid Returns ───────────────────────────────────────────────────────────

class IngridReturns(ReturnSystem):
    name = "Ingrid Returns"
    url_patterns = ["returns.ingrid.com", "ingrid.com/return"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[name=orderNumber]", "[name=orderId]"], order.order_number)
            await self._fill_field(page,
                ["[name=email]", "[type=email]"], order.customer_email or "")
            await self._find_and_click(page, ["button[type=submit]"], "submit")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                ["input[type=checkbox]", ".product-checkbox"], "select")
            await self._click_localized(page, r, "btn_next", label="next")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_confirm", label="confirm")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[Ingrid] Error: {e}")
            return False


# ─── Zigzag Returns ───────────────────────────────────────────────────────────

class ZigzagReturns(ReturnSystem):
    name = "Zigzag Returns"
    url_patterns = ["zigzag.global", "returns.zigzag"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[name=order_id]", "[placeholder*=Order]"], order.order_number)
            await self._fill_field(page,
                ["[name=email]", "[type=email]"], order.customer_email or "")
            await self._find_and_click(page, ["[type=submit]"], "submit")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page, ["input[type=checkbox]"], "select")
            await self._click_localized(page, r, "btn_start_return", label="start return")
            await page.wait_for_timeout(1000)

            await self._select_reason(page, order, ["select[name*=reason]", "select"])

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_continue",
                extra_css=["[type=submit]"], label="submit")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[Zigzag] Error: {e}")
            return False


# ─── Aftercare Returns ────────────────────────────────────────────────────────

class AftercareReturns(ReturnSystem):
    name = "Aftercare Returns"
    url_patterns = ["after.care", "aftercare.co"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            await self._fill_field(page,
                ["[name=order]", "[placeholder*=order]"], order.order_number)
            await self._fill_field(page,
                ["[name=email]", "[type=email]"], order.customer_email or "")
            await self._find_and_click(page, ["[type=submit]"], "submit")
            await page.wait_for_timeout(2000)

            await self._find_and_click(page,
                ["input[type=checkbox]", ".item"], "select item")
            await self._select_reason(page, order, ["select"])
            await page.wait_for_timeout(500)

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit",
                extra_css=["[type=submit]"], label="submit")
            await page.wait_for_timeout(2000)
            return True
        except Exception as e:
            logger.error(f"[Aftercare] Error: {e}")
            return False


# ─── Shopify Native Returns ───────────────────────────────────────────────────

class ShopifyReturns(ReturnSystem):
    name = "Shopify Returns"
    url_patterns = ["myshopify.com", "/apps/returns", "/pages/returns", "/account/orders"]

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        r = order.lang
        try:
            if "account" not in page.url:
                base = "/".join(page.url.split("/")[:3])
                await page.goto(f"{base}/account/login")
                await page.wait_for_timeout(1000)

            await self._fill_field(page,
                ["#account_email", "[name=email]"], order.customer_email or "")
            await self._click_localized(page, r, "btn_continue", label="continue")
            await page.wait_for_timeout(1000)

            await self._find_and_click(page,
                [f"a:has-text('{order.order_number}')"], "order link")
            await page.wait_for_timeout(1000)

            await self._click_localized(page, r, "btn_return",
                extra_css=["a:has-text('Return item')", "button:has-text('Return')"],
                label="return btn")
            await page.wait_for_timeout(1500)

            await self._find_and_click(page, ["input[type=checkbox]"], "select item")
            await self._select_reason(page, order, ["select[name*=reason]", "select"])
            await page.wait_for_timeout(500)

            if order.photo_urls and not order.store_covers_return:
                await self._upload_photos(page, order.photo_urls, region=r)

            await self._click_localized(page, r, "btn_submit",
                extra_css=["button[type=submit]"], label="submit")
            await page.wait_for_timeout(2000)
            logger.info(f"[Shopify] Return submitted for {order.order_number}")
            return True
        except Exception as e:
            logger.error(f"[Shopify] Error: {e}")
            return False


# ─── Router: detect system and delegate ──────────────────────────────────────

ALL_SYSTEMS: List[ReturnSystem] = [
    LoopReturns(),
    NarvarReturns(),
    AfterShipReturns(),
    ReturnlySystem(),
    HappyReturns(),
    RichReturns(),
    ReturnGo(),
    ClaimLane(),
    ClickPostReturns(),
    IngridReturns(),
    ZigzagReturns(),
    AftercareReturns(),
    ShopifyReturns(),  # Fallback — broad match last
]


async def auto_start_return(page: Page, order: OrderInfo) -> bool:
    """
    Detect which return system is on the current page and run it.
    Returns True on success, False on failure.
    """
    # Clear any captcha gate before entering the return portal
    await handle_captcha_page(page)

    current_url = page.url

    for system in ALL_SYSTEMS:
        if system.matches(current_url):
            logger.info(f"[router] Detected: {system.name} ({current_url[:60]})")
            return await system.start_return(page, order)

    logger.warning(f"[router] Unknown return system at {current_url[:80]}, trying generic")
    return await _generic_return(page, order)


class _GenericReturnSystem(ReturnSystem):
    name = "Generic"
    url_patterns = []

    async def start_return(self, page: Page, order: OrderInfo) -> bool:
        return False  # handled externally


async def _generic_return(page: Page, order: OrderInfo) -> bool:
    """Best-effort generic return flow for unknown portals."""
    r = order.lang
    generic = _GenericReturnSystem()

    try:
        await generic._fill_field(page,
            ["[name*=order]", "[placeholder*=order i]", "[id*=order]"], order.order_number)
        await generic._fill_field(page,
            ["[type=email]", "[name=email]"], order.customer_email or "")
        await generic._click_localized(page, r, "btn_continue",
            extra_css=["[type=submit]", "button:has-text('Start')"], label="submit")
        await page.wait_for_timeout(2000)

        await generic._find_and_click(page, ["input[type=checkbox]"], "checkbox")
        await generic._select_reason(page, order, ["select"])
        await page.wait_for_timeout(500)

        if order.photo_urls and not order.store_covers_return:
            await generic._upload_photos(page, order.photo_urls, region=r)

        await generic._click_localized(page, r, "btn_submit",
            extra_css=["[type=submit]"], label="submit")
        await page.wait_for_timeout(2000)
        return True
    except Exception as e:
        logger.error(f"[Generic] Error: {e}")
        return False


# ─── Photo download helper ────────────────────────────────────────────────────

async def _download_photos_to_tmp(photo_urls: List[str]) -> List[str]:
    """Download photos from Telegram CDN to /tmp and return local paths."""
    import httpx
    import tempfile
    paths = []
    async with httpx.AsyncClient(timeout=30) as client:
        for i, url in enumerate(photo_urls):
            try:
                r = await client.get(url)
                if r.status_code == 200:
                    tmp = os.path.join(tempfile.gettempdir(), f"ar_photo_{i}.jpg")
                    with open(tmp, "wb") as f:
                        f.write(r.content)
                    paths.append(tmp)
                    logger.info(f"[photos] Downloaded photo {i+1} to {tmp}")
            except Exception as e:
                logger.error(f"[photos] Download error for {url}: {e}")
    return paths
