"""
Live Chat Automation — AutoResolve RDP

Handles opening and conversing with merchant live chat widgets in the correct language.
Detects the chat platform (Intercom, Zendesk, Tawk, LiveChat, Freshchat, Crisp, Tidio),
opens the chat, sends the opening script in the page/region language, waits for an agent
response, detects the agent's language from their reply, and continues the conversation
in that language using canned scripts from locale_strings.py.

Supported platforms:
  Intercom, Zendesk Web Widget, Tawk.to, LiveChat, Freshchat, Crisp, Tidio, Gorgias

Usage:
  from live_chat import open_live_chat, ChatSession
  session = await open_live_chat(page, order, page_lang="de")
  if session:
      await session.send_opening()
      agent_lang = await session.wait_for_agent_and_detect_language()
      await session.send_follow_up(agent_lang)
"""
import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional

from playwright.async_api import Page, Locator

import locale_strings as L
from captcha_solver import handle_captcha_page

log = logging.getLogger("live_chat")


# ─── Platform detection signatures ────────────────────────────────────────────
# Each entry: (platform_name, list_of_detection_selectors)
# Detection runs in order; the first match wins.

PLATFORM_SIGNATURES = [
    ("intercom",   [
        "div[class*='intercom']",
        "iframe[name='intercom-messenger-frame']",
        "#intercom-container",
        "[data-testid*='intercom']",
    ]),
    ("zendesk",    [
        "iframe[id*='launcher']",
        "div[class*='zEWidget']",
        "#launcher",
        "iframe[title*='Messaging window']",
        "iframe[src*='zendesk']",
    ]),
    ("tawk",       [
        "iframe[id*='tawk']",
        "div[id*='tawk']",
        "iframe[src*='tawk.to']",
    ]),
    ("livechat",   [
        "div[id*='chat-widget']",
        "div[class*='livechat']",
        "iframe[src*='livechatinc']",
        "#live_chat_main_container",
    ]),
    ("freshchat",  [
        "div[id='freshchat-container']",
        "iframe[src*='freshchat']",
        "div[class*='freshchat']",
    ]),
    ("crisp",      [
        "div[id='crisp-chatbox']",
        "iframe[src*='crisp.chat']",
        ".crisp-client",
    ]),
    ("tidio",      [
        "iframe[id*='tidio']",
        "div[id*='tidio']",
        "iframe[src*='tidio']",
    ]),
    ("gorgias",    [
        "div[id='gorgias-chat-container']",
        "iframe[src*='gorgias']",
        "div[class*='gorgias']",
    ]),
    ("re_amaze",   [
        "div[id='reamaze-widget']",
        "iframe[src*='reamaze']",
    ]),
    ("helpscout",  [
        "div[id='beacon-container']",
        "iframe[src*='helpscout']",
        ".BeaconFabButtonFrame",
    ]),
]

# Generic fallback selectors tried if no named platform matched
GENERIC_CHAT_SELECTORS = [
    "button[aria-label*='chat' i]",
    "button[aria-label*='help' i]",
    "button[aria-label*='support' i]",
    "div[class*='chat-button']",
    "div[class*='chat-launcher']",
    "div[id*='chat-button']",
    "a[href*='chat']",
]

# Input selectors for typing in the chat (in priority order)
CHAT_INPUT_SELECTORS = [
    "textarea[placeholder*='message' i]",
    "textarea[aria-label*='message' i]",
    "div[contenteditable='true'][aria-label*='message' i]",
    "div[contenteditable='true'][class*='chat']",
    "input[placeholder*='message' i]",
    "textarea",
    "div[contenteditable='true']",
]

# Selectors for the send button
CHAT_SEND_SELECTORS = [
    "button[aria-label*='send' i]",
    "button[type='submit']",
    "button[class*='send']",
    "span[class*='send']",
    "div[class*='send'][role='button']",
]

# Selectors for agent message text
AGENT_MSG_SELECTORS = [
    "div[class*='agent'] p",
    "div[class*='from-agent'] p",
    "div[class*='message--agent'] p",
    "span[class*='agent-message']",
    "div[class*='chat-message']:not([class*='self']):not([class*='user']):not([class*='outgoing']) p",
    "article[class*='Message']:not([class*='from-me']) p",
    "div[data-testid*='agent-message']",
    "li[class*='message'][class*='response'] p",
]

AGENT_WAIT_POLL_MS = 3000
AGENT_WAIT_TIMEOUT = 120


# ─── Data structures ───────────────────────────────────────────────────────────

@dataclass
class ChatPlatform:
    name: str
    trigger_selector: str


@dataclass
class ChatSession:
    page: Page
    platform: ChatPlatform
    issue_type: str
    order_number: str
    customer_email: str
    page_lang: str
    iframe: Optional[any] = field(default=None)
    detected_agent_lang: str = "en"
    original_issue_type: str = ""   # Set for Followup orders — the original issue code

    async def _frame(self):
        """Return the relevant frame for interaction (iframe or main page)."""
        if self.iframe:
            return self.iframe
        return self.page

    async def _type_and_send(self, message: str) -> bool:
        """Type a message and hit send. Returns True on success."""
        frame = await self._frame()
        input_el: Optional[Locator] = None

        for sel in CHAT_INPUT_SELECTORS:
            try:
                el = frame.locator(sel).first
                if await el.is_visible(timeout=2000):
                    input_el = el
                    break
            except Exception:
                continue

        if not input_el:
            log.warning("[live_chat] Could not find chat input field")
            return False

        try:
            await input_el.click()
            await input_el.fill(message)
            await asyncio.sleep(0.4)

            # Try send button first
            sent = False
            for sel in CHAT_SEND_SELECTORS:
                try:
                    btn = frame.locator(sel).first
                    if await btn.is_visible(timeout=1500):
                        await btn.click()
                        sent = True
                        break
                except Exception:
                    continue

            # Fall back to pressing Enter
            if not sent:
                await input_el.press("Enter")

            log.info(f"[live_chat] Sent ({self.platform.name}): {message[:60]}...")
            return True

        except Exception as e:
            log.warning(f"[live_chat] Failed to type/send: {e}")
            return False

    async def send_opening(self) -> bool:
        """
        Send the initial issue opening message always in English.
        For Followup orders the message is context-aware of the original issue.
        Language adaption to the agent's language happens after their first reply.
        """
        key = L.issue_type_to_chat_key(self.issue_type)

        if key == "__followup__":
            # Use the context-aware followup script for the original issue type
            msg = L.followup_script(
                "en",
                self.original_issue_type,
                order_number=self.order_number,
                customer_email=self.customer_email,
            )
            log.info(
                f"[live_chat] Followup opening (original='{self.original_issue_type}') "
                f"in English, page_lang='{self.page_lang}'"
            )
        else:
            msg = L.live_chat_script(
                "en", key,
                order_number=self.order_number,
                customer_email=self.customer_email,
            )
            log.info(f"[live_chat] Opening in English (page_lang='{self.page_lang}'), key='{key}'")

        return await self._type_and_send(msg)

    async def send_script(self, lang: str, key: str, **kwargs) -> bool:
        """Send a canned script message in the given language."""
        if "order_number" not in kwargs:
            kwargs["order_number"] = self.order_number
        if "customer_email" not in kwargs:
            kwargs["customer_email"] = self.customer_email
        msg = L.live_chat_script(lang, key, **kwargs)
        return await self._type_and_send(msg)

    async def wait_for_agent_and_detect_language(self) -> str:
        """
        Poll for an agent reply, detect language from their text.
        Returns the detected ISO 639-1 language code.
        Times out after AGENT_WAIT_TIMEOUT seconds, returns 'en'.
        """
        frame = await self._frame()
        log.info("[live_chat] Waiting for agent reply...")

        elapsed = 0
        while elapsed < AGENT_WAIT_TIMEOUT:
            await asyncio.sleep(AGENT_WAIT_POLL_MS / 1000)
            elapsed += AGENT_WAIT_POLL_MS / 1000

            agent_text = await self._collect_agent_text(frame)
            if agent_text.strip():
                lang = L.detect_language_from_text(agent_text)
                log.info(f"[live_chat] Agent replied (detected lang='{lang}'): {agent_text[:80]}")
                self.detected_agent_lang = lang
                return lang

        log.warning("[live_chat] Timed out waiting for agent reply — defaulting to page lang")
        self.detected_agent_lang = self.page_lang
        return self.page_lang

    async def _collect_agent_text(self, frame) -> str:
        """Collect visible agent message text from the chat window."""
        for sel in AGENT_MSG_SELECTORS:
            try:
                els = frame.locator(sel)
                count = await els.count()
                if count > 0:
                    texts = []
                    for i in range(count):
                        t = await els.nth(i).inner_text()
                        if t.strip():
                            texts.append(t.strip())
                    if texts:
                        return " ".join(texts[-3:])
            except Exception:
                continue
        return ""

    async def continue_in_agent_language(self, key: str, **kwargs) -> bool:
        """Send a follow-up message using the detected agent language."""
        return await self.send_script(self.detected_agent_lang, key, **kwargs)


# ─── Platform detection ────────────────────────────────────────────────────────

async def detect_chat_platform(page: Page) -> Optional[ChatPlatform]:
    """
    Scan the page for known live chat widgets.
    Returns a ChatPlatform if found, or None if no chat widget is detected.
    """
    for name, selectors in PLATFORM_SIGNATURES:
        for sel in selectors:
            try:
                el = page.locator(sel).first
                if await el.is_visible(timeout=1500):
                    log.info(f"[live_chat] Detected platform: {name} (selector: {sel})")
                    return ChatPlatform(name=name, trigger_selector=sel)
            except Exception:
                continue

    for sel in GENERIC_CHAT_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=1000):
                log.info(f"[live_chat] Detected generic chat trigger: {sel}")
                return ChatPlatform(name="generic", trigger_selector=sel)
        except Exception:
            continue

    return None


# ─── Language-aware language switcher ─────────────────────────────────────────
# Some sites show an interface language picker in the chat widget.
# These selectors try to find and switch to the preferred language.

_LANG_SWITCHER_SELECTORS = [
    "select[name*='language']",
    "select[aria-label*='language' i]",
    "button[aria-label*='language' i]",
    "div[class*='language-picker']",
    "div[class*='lang-select']",
]

async def try_switch_chat_language(page: Page, target_lang: str) -> bool:
    """
    Attempt to switch the chat widget UI language to target_lang.
    Returns True if successful, False otherwise.
    """
    for sel in _LANG_SWITCHER_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=1500):
                tag = await el.evaluate("el => el.tagName.toLowerCase()")
                if tag == "select":
                    await el.select_option(value=target_lang)
                    log.info(f"[live_chat] Switched chat language to '{target_lang}'")
                    return True
                else:
                    await el.click()
                    await asyncio.sleep(0.5)
                    lang_option = page.locator(
                        f"li:has-text('{target_lang}'), a:has-text('{target_lang}')"
                    ).first
                    if await lang_option.is_visible(timeout=1000):
                        await lang_option.click()
                        return True
        except Exception:
            continue
    return False


# ─── Chat widget opener ────────────────────────────────────────────────────────

_OPENER_SEQUENCES: dict = {
    "intercom": [
        "div.intercom-launcher",
        "button[class*='intercom-launcher']",
        "iframe[name='intercom-launcher-frame']",
    ],
    "zendesk": [
        "iframe[id*='launcher']",
        "button#launcher",
    ],
    "tawk": [
        "iframe[id*='tawk']",
        "div[id*='tawk']",
    ],
    "livechat": [
        "#live_chat_main_container",
        "div[class*='livechat-trigger']",
    ],
    "freshchat": [
        "div#freshchat-container",
        "div[class*='freshchat-icon']",
    ],
    "crisp": [
        ".crisp-client div[data-id]",
        "div#crisp-chatbox div[class*='ccw']",
    ],
    "tidio": [
        "iframe[id*='tidio']",
        "#tidio-chat-iframe",
    ],
    "gorgias": [
        "#gorgias-chat-container",
    ],
    "re_amaze": [
        "#reamaze-widget",
    ],
    "helpscout": [
        "iframe.BeaconFabButtonFrame",
        "div#beacon-container button",
    ],
    "generic": [],
}


async def open_chat_widget(page: Page, platform: ChatPlatform) -> Optional[any]:
    """
    Open the chat widget for the detected platform.
    Returns the iframe content frame if the chat is in an iframe, or None for same-frame.
    """
    openers = _OPENER_SEQUENCES.get(platform.name, [])
    openers = openers + [platform.trigger_selector]

    for sel in openers:
        try:
            el = page.locator(sel).first

            tag = await el.evaluate("el => el.tagName.toLowerCase()", timeout=1000)
            if tag == "iframe":
                frame = await el.content_frame()
                if frame:
                    trigger = frame.locator("button, div[role='button'], a[role='button']").first
                    if await trigger.is_visible(timeout=2000):
                        await trigger.click()
                        await asyncio.sleep(1.5)
                        log.info(f"[live_chat] Opened {platform.name} via iframe trigger")
                        return frame
            else:
                if await el.is_visible(timeout=1500):
                    await el.click()
                    await asyncio.sleep(1.5)
                    log.info(f"[live_chat] Opened {platform.name} via click on {sel}")
                    return None

        except Exception:
            continue

    return None


# ─── Page language detection ───────────────────────────────────────────────────

async def detect_page_language(page: Page, region: str = "us") -> str:
    """
    Detect the current language the page is displayed in.

    Detection order:
      1. <html lang="..."> attribute
      2. <meta http-equiv="Content-Language"> tag
      3. Open Graph locale meta tag
      4. Common page-body text heuristics
      5. Fallback to region-derived language

    Returns an ISO 639-1 language code.
    """
    # 1. HTML lang attribute
    try:
        html_lang = await page.evaluate("document.documentElement.lang || ''")
        if html_lang:
            detected = L.normalize_html_lang(html_lang)
            log.info(f"[page_lang] HTML lang='{html_lang}' → '{detected}'")
            return detected
    except Exception:
        pass

    # 2. Content-Language meta tag
    try:
        meta_lang = await page.evaluate(
            "document.querySelector('meta[http-equiv=\"Content-Language\"]')?.content || ''"
        )
        if meta_lang:
            detected = L.normalize_html_lang(meta_lang)
            log.info(f"[page_lang] meta Content-Language='{meta_lang}' → '{detected}'")
            return detected
    except Exception:
        pass

    # 3. OG locale
    try:
        og_locale = await page.evaluate(
            "document.querySelector('meta[property=\"og:locale\"]')?.content || ''"
        )
        if og_locale:
            lang_part = og_locale.split("_")[0]
            detected = L.normalize_html_lang(lang_part)
            log.info(f"[page_lang] og:locale='{og_locale}' → '{detected}'")
            return detected
    except Exception:
        pass

    # 4. Heuristic text sampling
    try:
        body_text = await page.evaluate(
            "document.body?.innerText?.slice(0, 800) || ''"
        )
        if body_text:
            detected = L.detect_language_from_text(body_text)
            if detected != "en":
                log.info(f"[page_lang] Heuristic body text detection → '{detected}'")
                return detected
    except Exception:
        pass

    # 5. Fall back to region-derived language
    fallback = L.get_lang(region)
    log.info(f"[page_lang] Fallback from region='{region}' → '{fallback}'")
    return fallback


# ─── Language switcher for the merchant website ────────────────────────────────
# Some sites let you switch the site language. We use this to align the page
# to the agent's language when they reply in a different language.

_SITE_LANG_SWITCH_PATTERNS = [
    "a[href*='/en/'], a[href*='/de/'], a[href*='/fr/'], a[href*='/it/'], a[href*='/es/'], a[href*='/nl/']",
    "button[data-lang], button[data-language]",
    "select[name='language'], select[name='locale']",
    "a[hreflang], link[hreflang]",
]


async def try_switch_site_language(page: Page, target_lang: str) -> bool:
    """
    Attempt to switch the merchant website to target_lang.
    Useful when the page is in the wrong language for the user's region.
    Returns True if successful.
    """
    # 1. Try <select name="language">
    try:
        sel = page.locator("select[name='language'], select[name='locale']").first
        if await sel.is_visible(timeout=1500):
            await sel.select_option(value=target_lang)
            await page.wait_for_load_state("networkidle", timeout=5000)
            log.info(f"[site_lang] Switched via select to '{target_lang}'")
            return True
    except Exception:
        pass

    # 2. Try buttons with data-lang attribute
    try:
        btn = page.locator(f"button[data-lang='{target_lang}'], button[data-language='{target_lang}']").first
        if await btn.is_visible(timeout=1500):
            await btn.click()
            await page.wait_for_load_state("networkidle", timeout=5000)
            log.info(f"[site_lang] Switched via data-lang button to '{target_lang}'")
            return True
    except Exception:
        pass

    # 3. Try hreflang links
    try:
        link = page.locator(f"a[hreflang='{target_lang}']").first
        if await link.is_visible(timeout=1500):
            await link.click()
            await page.wait_for_load_state("networkidle", timeout=5000)
            log.info(f"[site_lang] Switched via hreflang link to '{target_lang}'")
            return True
    except Exception:
        pass

    # 4. Try URL-based language links (e.g. /de/ or /en/)
    try:
        link = page.locator(f"a[href*='/{target_lang}/'], a[href*='/{target_lang}-']").first
        if await link.is_visible(timeout=1500):
            await link.click()
            await page.wait_for_load_state("networkidle", timeout=5000)
            log.info(f"[site_lang] Switched via URL lang link to '{target_lang}'")
            return True
    except Exception:
        pass

    log.info(f"[site_lang] Could not switch site language to '{target_lang}'")
    return False


# ─── Main entry point ──────────────────────────────────────────────────────────

async def open_live_chat(
    page: Page,
    issue_type: str,
    order_number: str,
    customer_email: str,
    region: str = "us",
    page_lang: Optional[str] = None,
    original_issue_type: str = "",
) -> Optional[ChatSession]:
    """
    Detect and open a live chat widget on the current page, returning a ChatSession.

    Args:
        page:                Playwright page object
        issue_type:          Order issue type (Step1, DNA, EB, LIT, Followup, etc.)
        order_number:        Customer order number
        customer_email:      Customer email address
        region:              Region code (us, de, fr, etc.) — used for language fallback
        page_lang:           Override detected page language (ISO 639-1 code)
        original_issue_type: For Followup orders — the original issue code (DNA, Step1, etc.)

    Returns:
        ChatSession ready for send_opening(), or None if no chat widget found.
    """
    if page_lang is None:
        page_lang = await detect_page_language(page, region)

    platform = await detect_chat_platform(page)
    if not platform:
        log.info("[live_chat] No live chat widget detected on this page")
        return None

    iframe = await open_chat_widget(page, platform)
    await asyncio.sleep(1.0)

    session = ChatSession(
        page=page,
        platform=platform,
        issue_type=issue_type,
        order_number=order_number,
        customer_email=customer_email,
        page_lang=page_lang,
        iframe=iframe,
        original_issue_type=original_issue_type,
    )

    log.info(
        f"[live_chat] Session ready: platform={platform.name}, lang={page_lang}, "
        f"issue={issue_type}" + (f" (orig={original_issue_type})" if original_issue_type else "")
        + f", order={order_number}"
    )
    return session


# ─── Automated live chat flow ─────────────────────────────────────────────────

async def run_live_chat_flow(
    page: Page,
    issue_type: str,
    order_number: str,
    customer_email: str,
    region: str = "us",
    request_refund: bool = True,
    original_issue_type: str = "",
) -> dict:
    """
    Full automated live chat flow:
      1. Detect page language
      2. Open the chat widget
      3. Send the opening script in the page language
      4. Wait for agent reply and detect their language
      5. Send follow-up in the agent's language
      6. If refund requested, send refund request in agent's language

    Returns a dict with:
      {
        "success": bool,
        "platform": str,
        "page_lang": str,
        "agent_lang": str,
        "messages_sent": int,
      }
    """
    result = {
        "success": False,
        "platform": "none",
        "page_lang": "en",
        "agent_lang": "en",
        "messages_sent": 0,
    }

    # Clear any captcha gate before trying to open the chat widget
    await handle_captcha_page(page)

    session = await open_live_chat(
        page=page,
        issue_type=issue_type,
        order_number=order_number,
        customer_email=customer_email,
        region=region,
        original_issue_type=original_issue_type,
    )

    if not session:
        return result

    result["platform"] = session.platform.name
    result["page_lang"] = session.page_lang

    # Opening is always in English regardless of page/region language
    ok = await session.send_opening()
    if ok:
        result["messages_sent"] += 1

    # Wait for agent reply and detect what language they respond in
    agent_lang = await session.wait_for_agent_and_detect_language()
    result["agent_lang"] = agent_lang

    # All subsequent messages are sent in the agent's detected language
    if agent_lang != "en":
        log.info(
            f"[live_chat] Agent replied in '{agent_lang}' — adapting all follow-ups to that language"
        )

    # Send appropriate follow-up in agent's language
    if issue_type == "Followup":
        # Followup orders: re-state context in the agent's language using the
        # context-aware followup script, then request a refund
        follow_msg = L.followup_script(
            agent_lang,
            original_issue_type,
            order_number=order_number,
            customer_email=customer_email,
        )
        ok2 = await session._type_and_send(follow_msg)
    else:
        follow_key = {
            "Step1": "step1_follow",
            "DNA":   "dna_follow",
            "EB":    "eb_follow",
            "LIT":   "lit_follow",
            "Step2": "step2_opening",
        }.get(issue_type, "dna_follow")
        ok2 = await session.continue_in_agent_language(follow_key)

    if ok2:
        result["messages_sent"] += 1

    # Optionally request refund
    if request_refund:
        await asyncio.sleep(2)
        ok3 = await session.continue_in_agent_language("request_refund")
        if ok3:
            result["messages_sent"] += 1

    result["success"] = result["messages_sent"] > 0
    return result
