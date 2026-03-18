import { storage } from "./storage";
import { sendTelegramRetailMessage, triggerAutomation } from "./routes/retail";
import { decrypt } from "./crypto";
import bcrypt from "bcryptjs";

let pollingOffset = 0;
let pollingActive = false;

// ─── OTP / 2FA verification flow ─────────────────────────────────────────────
// chat_id → otp_request_id — tracks chats actively waiting for an OTP reply
const otpWaitingChats = new Map<string, string>();

async function otpListener() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const mainChatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) return;

  setInterval(async () => {
    try {
      // Send notification for pending OTP requests
      const pending = await storage.getPendingOtpRequests();
      for (const req of pending) {
        const order = await storage.getRetailOrder(req.orderId).catch(() => null);
        if (!order) continue;

        const destination = req.otpDestination || "";
        const intro = req.retry
          ? `🔄 *${req.platform}* has sent a new verification code.`
          : `🔐 *${req.platform}* needs a verification code to continue.`;
        const destLine = destination
          ? `It was sent to: \`${destination}\``
          : "Check your phone or email for the code.";
        const msg = `${intro}\n\n${destLine}\n\nPlease reply with the code.\n\n_Order: ${order.orderNumber}_`;

        // Post to operator chat
        if (mainChatId) {
          await tgSend({ text: msg }, parseInt(mainChatId));
          otpWaitingChats.set(mainChatId, req.id);
        }

        await storage.updateOtpRequest(req.id, {
          botStatus: "awaiting_code",
          sentAt: new Date(),
        });
      }

      // Handle expired OTPs — ask if user wants a retry
      const expired = await storage.getExpiredOtpRequests();
      for (const req of expired) {
        const order = await storage.getRetailOrder(req.orderId).catch(() => null);
        if (!order) continue;
        const msg =
          `⚠️ The *${req.platform}* verification code expired before it was received.\n\n` +
          `Would you like to try again? Reply *yes* to request a new code, or *no* to skip.\n\n` +
          `_Order: ${order.orderNumber}_ | _OTP ID: ${req.id}_`;
        if (mainChatId) await tgSend({ text: msg }, parseInt(mainChatId));
        await storage.updateOtpRequest(req.id, { botStatus: "apologized" });
      }
    } catch (e: any) {
      console.error("[otp-listener] error:", e?.message);
    }
  }, 3000);
}

// ─── Session authentication (password gate) ──────────────────────────────────
// The bot requires the dashboard password to be sent via Telegram after every
// server restart before it will process any order commands. Once authenticated
// the session stays active for 5 hours before requiring re-entry.

const SESSION_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours
let botAuthenticated = false;
let awaitingPassword = false;
let authTimestamp: number | null = null;

function checkSessionExpiry(): boolean {
  if (!botAuthenticated || authTimestamp === null) return false;
  if (Date.now() - authTimestamp > SESSION_TTL_MS) {
    botAuthenticated = false;
    awaitingPassword = true;
    authTimestamp = null;
    console.log("[telegram-bot] Session expired after 5 hours — re-authentication required");
    return true; // session just expired
  }
  return false; // session still valid
}

// ─── Pending state: Step1 orders awaiting photos ─────────────────────────────

interface PendingOrder {
  merchantName: string;
  orderNumber: string;
  issueCode: string;
  notes?: string;
  customerName?: string;
  customerEmail?: string;
  chatId: number;
  ts: number;
}

const pendingPhotoOrders = new Map<number, PendingOrder[]>();
const pendingPhotos = new Map<number, string[]>();
const PHOTO_WAIT_MS = 5 * 60 * 1000;

// ─── Retry / backoff helpers ──────────────────────────────────────────────────

/**
 * Retry an async operation with exponential backoff.
 * Handles Telegram 429 (Too Many Requests) by reading retry_after from the body.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 4,
  baseDelayMs = 1000,
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isLast = attempt === maxAttempts;
      if (isLast) {
        console.error(`[telegram-bot] ${label} failed after ${maxAttempts} attempts:`, err?.message ?? err);
        return null;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.warn(`[telegram-bot] ${label} attempt ${attempt} failed, retrying in ${delay}ms…`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

/**
 * Telegram-specific send with 429 backoff support.
 */
export async function tgSend(payload: object, chatId?: number): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const rawChatId = process.env.TELEGRAM_CHAT_ID;
  const defaultChatId = rawChatId && !rawChatId.startsWith("-") ? `-${rawChatId}` : rawChatId;
  if (!token) return null;

  const body = {
    chat_id: chatId ?? defaultChatId,
    parse_mode: "Markdown",
    ...payload,
  };

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // Telegram always returns HTTP 200 — must check data.ok inside
      let data: any = null;
      try { data = await res.json(); } catch { /* ignore */ }

      if (data?.ok === true) {
        return data.result?.message_id ?? null;
      }

      const errCode: number = data?.error_code ?? res.status;
      const errDesc: string = data?.description ?? "";

      if (errCode === 429) {
        const retryAfter = data?.parameters?.retry_after ?? 5;
        console.warn(`[telegram-bot] Rate limited (429), waiting ${retryAfter}s…`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      if (errCode >= 500) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.warn(`[telegram-bot] Telegram ${errCode}, retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // 400 Bad Request — almost always a Markdown parse error. Retry once without formatting.
      console.warn(`[telegram-bot] Telegram ${errCode} (${errDesc}), retrying without Markdown…`);
      try {
        const { parse_mode: _drop, ...bodyNoMd } = body as any;
        const res2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyNoMd),
        });
        const d2 = await res2.json().catch(() => null) as any;
        if (d2?.ok === true) return d2.result?.message_id ?? null;
        console.error(`[telegram-bot] Plain-text retry also failed: ${d2?.description ?? "unknown"}`);
      } catch (e2: any) {
        console.error(`[telegram-bot] Plain-text retry error:`, e2?.message);
      }
      return null;
    } catch (err: any) {
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.warn(`[telegram-bot] Network error on send, retrying in ${delay}ms:`, err?.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return null;
}

/**
 * Delete a previously sent Telegram message.
 * Exported so the retail routes can call it on order auto-delete.
 */
export async function tgDeleteMessage(chatId: string | number, messageId: string | number): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !messageId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: Number(messageId) }),
    });
  } catch { /* best-effort */ }
}

/** Escape characters that have special meaning in Telegram HTML mode. */
function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ─── Message line parser ──────────────────────────────────────────────────────

// Multilingual aliases → canonical issue code.
// Mirrors ISSUE_CODE_ALIASES in locale_strings.py so Telegram users can send
// orders using their own language (e.g. "reso", "retoure", "retour", "devolución").
const ISSUE_CODE_ALIASES: Record<string, string> = {
  // ── Step1 (Create Return) ──────────────────────────────────────
  step1: "Step1",
  reso: "Step1", rientro: "Step1", resomerce: "Step1",
  retour: "Step1", renvoi: "Step1",
  retoure: "Step1", rücksendung: "Step1", rucksendung: "Step1",
  rückgabe: "Step1", ruckgabe: "Step1",
  devolucion: "Step1", "devolución": "Step1", retorno: "Step1",
  terugzending: "Step1",
  devolucao: "Step1", "devolução": "Step1",
  "返品": "Step1",

  // ── DNA (Did Not Arrive) ───────────────────────────────────────
  dna: "DNA",
  nonarrivato: "DNA", nonpervenuto: "DNA", nda: "DNA", nonricevuto: "DNA",
  nonrecu: "DNA", "nonreçu": "DNA", pasrecu: "DNA", "pasreçu": "DNA",
  jamaisrecu: "DNA",
  nichtangekommen: "DNA", nichtgeliefert: "DNA", nichtbekommen: "DNA",
  nichterhalten: "DNA",
  nollegado: "DNA", "nollegó": "DNA", norecibido: "DNA",
  nietthuisbezorgd: "DNA", nichtgeleverd: "DNA", nietontvangen: "DNA",
  naochegou: "DNA", naorecebido: "DNA", "nãochegou": "DNA",
  "未着": "DNA", "届かない": "DNA",

  // ── EB (Empty Box) ─────────────────────────────────────────────
  eb: "EB",
  scatolavuota: "EB", boxvuota: "EB",
  boitevide: "EB", "boîtevide": "EB", cartonvide: "EB",
  leerebox: "EB", leererkarton: "EB", leerkarton: "EB", leerepackung: "EB",
  cajavacia: "EB", "cajavaciá": "EB",
  legedoos: "EB", legebak: "EB",
  caixavazia: "EB",
  "空箱": "EB",

  // ── LIT (Lost In Transit) ──────────────────────────────────────
  lit: "LIT",
  persoincorriere: "LIT", smarritoincorriere: "LIT", perdutoincorriere: "LIT",
  perduencorreo: "LIT", perdutransport: "LIT", perduentransit: "LIT",
  verlorenimtransport: "LIT", verloren: "LIT", verloreninzustellung: "LIT",
  perdidoencorreo: "LIT", perdidoentransito: "LIT", extraviado: "LIT",
  verloreningpost: "LIT", verloreninpost: "LIT",
  perdidoentransporte: "LIT", perdidonocorreiro: "LIT",
  "配送中紛失": "LIT", "配送中に紛失": "LIT",

  // ── Step2 (Return Not Processed) ──────────────────────────────
  step2: "Step2",
  resonoelaborato: "Step2", rimborsononricevuto: "Step2",
  retournontraite: "Step2", remboursementenattente: "Step2",
  "rückerstattung": "Step2", ruckerstattung: "Step2",
  devolucionnotratada: "Step2", reembolsopendiente: "Step2",
  devolucaonaotratada: "Step2",

  // ── Followup ───────────────────────────────────────────────────
  followup: "Followup", "follow-up": "Followup", follow_up: "Followup",
  suivi: "Followup", nachverfolgung: "Followup", nf: "Followup",
  seguimiento: "Followup", opvolging: "Followup", seguimento: "Followup",
  "フォローアップ": "Followup",
};

/**
 * Normalize a raw token to a canonical issue code.
 * Tries the aliases map first, then strips accents and tries again.
 * Returns the canonical code (e.g. "Step1") or null if no match.
 */
function normalizeIssueCode(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  if (ISSUE_CODE_ALIASES[lower]) return ISSUE_CODE_ALIASES[lower];
  // Strip combining accents (NFD decomposition → remove Mn category chars)
  const stripped = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (ISSUE_CODE_ALIASES[stripped]) return ISSUE_CODE_ALIASES[stripped];
  return null;
}

interface ParsedOrderLine {
  merchantName: string;
  orderNumber: string;
  issueCode: string;
  followupOf?: string;      // recognised code when Followup+<code> (e.g. DNA, Step2)
  followupNote?: string;    // free-text when Followup+<custom note>
  customerName?: string;
  customerEmail?: string;
  formResponseId?: string;  // set when the line was "<UUID> <IssueCode>" — resolved before order creation
}

// UUID format: 8-4-4-4-12 hex digits
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tryParseOrderLine(line: string): ParsedOrderLine | null {
  const tokens = line.trim().split(/\s+/);

  // ── Form-ID format: <UUID> <IssueCode>  [optional Followup suffix] ──────────
  // e.g. "550e8400-e29b-41d4-a716-446655440000 DNA"
  //      "550e8400-e29b-41d4-a716-446655440000 Followup+Step2"
  if (tokens.length >= 2 && UUID_RE.test(tokens[0])) {
    const formResponseId = tokens[0];
    const codeToken = tokens[1];

    // Check for Followup+ syntax first
    const newFollowupMatch = codeToken.match(/^followup\+(.+)$/i);
    if (newFollowupMatch) {
      const suffixTokens = [newFollowupMatch[1], ...tokens.slice(2)];
      const suffix = suffixTokens.join(" ").trim();
      const baseCode = normalizeIssueCode(suffixTokens[0]);
      return {
        merchantName: "", orderNumber: "", issueCode: "Followup",
        followupOf: baseCode || undefined,
        followupNote: baseCode ? undefined : suffix,
        formResponseId,
      };
    }

    const code = normalizeIssueCode(codeToken);
    if (code) {
      return { merchantName: "", orderNumber: "", issueCode: code, formResponseId };
    }
    return null; // UUID present but unrecognised code — don't fall through
  }

  if (tokens.length < 3) return null;

  let resolvedCode: string | null = null;
  let issueCodePos = -1;
  let followupOf: string | undefined;
  let followupNote: string | undefined;

  for (let i = 2; i < tokens.length; i++) {
    // New forward format: Followup+<codeword>  or  Followup+<free text joined below>
    // e.g. "Nike 123 Followup+DNA"  or  "Nike 123 Followup+package+arrived+damaged"
    const newFollowupMatch = tokens[i].match(/^followup\+(.+)$/i);
    if (newFollowupMatch) {
      // Collect all remaining tokens after the "+" as potential multi-word note
      // (user may type them space-separated; the "+" only joins the keyword itself)
      const suffixTokens = [newFollowupMatch[1], ...tokens.slice(i + 1)];
      const suffix = suffixTokens.join(" ").trim();
      const baseCode = normalizeIssueCode(suffixTokens[0]);
      resolvedCode = "Followup";
      issueCodePos = i;
      if (baseCode) {
        followupOf = baseCode;
      } else {
        followupNote = suffix; // free-text description
      }
      // All tokens from i+1 onward are consumed as part of the followup note
      tokens.splice(i + 1);
      break;
    }

    // Legacy reverse format: <originalCode>+Followup  (e.g. Step2+Followup)
    const legacyFollowupMatch = tokens[i].match(/^(.+)\+followup$/i);
    if (legacyFollowupMatch) {
      const baseCode = normalizeIssueCode(legacyFollowupMatch[1]);
      if (baseCode) {
        resolvedCode = "Followup";
        issueCodePos = i;
        followupOf = baseCode;
        break;
      }
    }

    // Standard single issue code
    const code = normalizeIssueCode(tokens[i]);
    if (code) {
      resolvedCode = code;
      issueCodePos = i;
      break;
    }
  }
  if (!resolvedCode || issueCodePos === -1) return null;

  const issueCode = resolvedCode;
  const orderNumber = tokens[issueCodePos - 1];
  const merchantName = tokens.slice(0, issueCodePos - 1).join(" ");
  if (!merchantName || !orderNumber) return null;

  const remaining = tokens.slice(issueCodePos + 1);
  let customerEmail: string | undefined;
  let customerName: string | undefined;

  for (const tok of remaining) {
    if (tok.includes("@")) customerEmail = tok;
  }
  const nameTokens = remaining.filter((t) => !t.includes("@"));
  if (nameTokens.length > 0) customerName = nameTokens.join(" ");

  return { merchantName, orderNumber, issueCode, followupOf, followupNote, customerName, customerEmail };
}

function parseMessageText(text: string): { orders: ParsedOrderLine[]; notes: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const orders: ParsedOrderLine[] = [];
  const noteLines: string[] = [];

  for (const line of lines) {
    const parsed = tryParseOrderLine(line);
    if (parsed) orders.push(parsed);
    else noteLines.push(line);
  }

  return { orders, notes: noteLines.join("\n").trim() };
}

// ─── Telegram API ─────────────────────────────────────────────────────────────

async function clearWebhook(token: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`);
    console.log("[telegram-bot] Webhook cleared");
  } catch { /* ignore */ }
}

async function setWebhook(token: string, url: string, secret: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, secret_token: secret, drop_pending_updates: false }),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (data.ok) {
      console.log(`[telegram-bot] Webhook registered: ${url}`);
      return true;
    }
    console.error("[telegram-bot] setWebhook failed:", data.description);
    return false;
  } catch (e: any) {
    console.error("[telegram-bot] setWebhook error:", e.message);
    return false;
  }
}

async function registerBotCommands(token: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        commands: [
          { command: "start",    description: "Activate bot / show order format" },
          { command: "help",     description: "Show usage guide and issue codes" },
          { command: "status",   description: "Show active orders and current processing step" },
          { command: "orders",   description: "View pending and in-progress orders" },
          { command: "cancel",   description: "Cancel a stuck order: /cancel <OrderNumber>" },
          { command: "resubmit", description: "Clear and resubmit an order: /resubmit <OrderNumber>" },
          { command: "sessions", description: "View active automation sessions" },
          { command: "stats",    description: "Dashboard overview and stats" },
        ],
      }),
    });
    console.log("[telegram-bot] Bot commands registered");
  } catch (e: any) {
    console.warn("[telegram-bot] setMyCommands failed:", e.message);
  }
}

/** Called by the webhook HTTP route to process an incoming update. */
export async function dispatchWebhookUpdate(update: any): Promise<void> {
  try {
    await handleUpdate(update);
  } catch (e) {
    console.error("[telegram-bot] Webhook handler error:", e);
  }
}

async function getUpdates(): Promise<any[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return [];

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${pollingOffset}&timeout=20&allowed_updates=["message"]`,
        { signal: AbortSignal.timeout(25000) },
      );

      if (res.status === 409) {
        // Another instance is still polling — clear webhook and wait for it to die
        const wait = attempt === 1 ? 10000 : 20000;  // 10s first, then 20s each
        console.warn(`[telegram-bot] 409 Conflict (attempt ${attempt}) — waiting ${wait / 1000}s for other instance to stop`);
        await clearWebhook(token);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (res.status === 429) {
        const data = await res.json().catch(() => ({})) as any;
        const wait = (data?.parameters?.retry_after ?? 10) * 1000;
        console.warn(`[telegram-bot] Rate limited (429), waiting ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const delay = 2000 * Math.pow(2, attempt - 1);
        console.warn(`[telegram-bot] getUpdates HTTP ${res.status}, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      const data = await res.json() as any;
      return data.result ?? [];
    } catch (err: any) {
      const delay = 2000 * Math.pow(2, attempt - 1);
      console.warn(`[telegram-bot] getUpdates error (attempt ${attempt}): ${err?.message}, retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return [];
}

// ─── Form response lookup ─────────────────────────────────────────────────────

interface CustomerInfo {
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  allAnswers: Record<string, string>;
}

// Looks up a form submission directly by its UUID and returns order/customer details.
async function findFormDataByResponseId(responseId: string): Promise<{
  orderNumber: string | null;
  merchantName: string | null;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  allAnswers: Record<string, string>;
} | null> {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const legacyKey = process.env.DASHBOARD_PASSWROD || process.env.DASHBOARD_PASSWORD;
  try {
    const response = await storage.getResponse(responseId);
    if (!response) return null;
    let answers: Record<string, string> = {};
    for (const key of [encryptionKey, legacyKey].filter(Boolean) as string[]) {
      try {
        const decrypted = decrypt(response.encryptedData, key);
        const parsed = JSON.parse(decrypted);
        answers = parsed.answers || {};
        break;
      } catch { /* try next key */ }
    }
    if (Object.keys(answers).length === 0) return null;
    const orderFields = ["order_ref", "order_number", "order_id", "order_no"];
    const merchantFields = ["merchant", "store", "retailer", "merchant_name", "store_name", "brand"];
    const orderNumber = orderFields.map((f) => answers[f]).find(Boolean) ?? null;
    const merchantName = merchantFields.map((f) => answers[f]).find(Boolean) ?? null;
    const customerName = answers["full_name"] || answers["customer_name"] || answers["name"] || undefined;
    const customerEmail = answers["email"] || answers["customer_email"] || undefined;
    const customerPhone = answers["phone"] || answers["customer_phone"] || undefined;
    return { orderNumber, merchantName, customerName, customerEmail, customerPhone, allAnswers: answers };
  } catch (e) {
    console.warn("[telegram-bot] Form ID lookup error:", e);
    return null;
  }
}

async function findFormDataByOrderNumber(orderNumber: string): Promise<CustomerInfo | null> {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const legacyKey = process.env.DASHBOARD_PASSWROD || process.env.DASHBOARD_PASSWORD;

  try {
    const allResponses = await storage.getAllResponses();
    const normalizedOrder = orderNumber.toLowerCase().trim();

    for (const r of allResponses) {
      let answers: Record<string, string> = {};

      // Try primary key first, then legacy key as fallback
      for (const key of [encryptionKey, legacyKey].filter(Boolean) as string[]) {
        try {
          const decrypted = decrypt(r.encryptedData, key);
          const parsed = JSON.parse(decrypted);
          answers = parsed.answers || {};
          break; // decryption succeeded
        } catch {
          // try next key
        }
      }

      if (Object.keys(answers).length === 0) continue;

      // Check all common order reference fields
      const orderFields = ["order_ref", "order_number", "order_id", "order_no"];
      const foundRef = orderFields.some((f) => answers[f]?.toLowerCase().trim() === normalizedOrder);
      if (!foundRef) continue;

      const customerName = answers["full_name"] || answers["customer_name"] || answers["name"] || undefined;
      const customerEmail = answers["email"] || answers["customer_email"] || undefined;
      const customerPhone = answers["phone"] || answers["customer_phone"] || undefined;

      return { customerName, customerEmail, customerPhone, allAnswers: answers };
    }
  } catch (e) {
    console.warn("[telegram-bot] Response lookup error:", e);
  }

  return null;
}

// ─── Order creation ───────────────────────────────────────────────────────────

const issueLabels: Record<string, string> = {
  DNA: "Did Not Arrive", EB: "Empty Box", Step1: "Create Return",
  Step2: "Return Not Processed", LIT: "Lost In Transit", Followup: "Followup",
};

async function createOrderFromParsed(
  parsed: ParsedOrderLine,
  chatId: number,
  notes?: string,
  photoFileIds?: string[],
  silent?: boolean,
): Promise<void> {
  // Look up full form submission if not already provided
  const formCustomer = (!parsed.customerName && !parsed.customerEmail)
    ? await findFormDataByOrderNumber(parsed.orderNumber)
    : null;

  const resolvedName = parsed.customerName || formCustomer?.customerName;
  const resolvedEmail = parsed.customerEmail || formCustomer?.customerEmail;
  const resolvedPhone = formCustomer?.customerPhone;

  const result = await withRetry(async () => {
    const existing = await storage.getRetailOrderByNumber(parsed.orderNumber, parsed.merchantName);
    if (existing) {
      await tgSend({
        text:
          `⚠️ <b>Already Exists</b>\n\n` +
          `Order <code>${escHtml(parsed.orderNumber)}</code> for <b>${escHtml(parsed.merchantName)}</b> is already in the system.\n` +
          `Status: <b>${escHtml(existing.status)}</b>`,
        parse_mode: "HTML",
      }, chatId);
      return "exists";
    }

    // Build context prefix for the automation layer.
    // [orig:<code>] carries the original issue code; free-text followup notes are
    // prepended as [followup-note: ...] so downstream automation can read them.
    const fullNotes = [
      parsed.followupOf ? `[orig:${parsed.followupOf}]` : null,
      parsed.followupNote ? `[followup-note: ${parsed.followupNote}]` : null,
      resolvedPhone ? `phone:${resolvedPhone}` : null,
      notes || null,
    ].filter(Boolean).join(" ") || null;

    const order = await storage.createRetailOrder({
      orderNumber: parsed.orderNumber,
      merchantName: parsed.merchantName,
      issueType: parsed.issueCode,
      desiredOutcome: "Refund",
      status: "pending",
      region: "usa",
      notes: fullNotes,
      customerName: resolvedName || null,
      customerEmail: resolvedEmail || null,
      photoFileIds: photoFileIds ?? [],
      telegramChatId: String(chatId),
    });

    await storage.logRetailActivity({
      action: parsed.issueCode === "Step1" ? "step1_order_created" : "order_created_via_telegram",
      details: `${parsed.merchantName} #${parsed.orderNumber} (${parsed.issueCode}${parsed.followupOf ? " of " + parsed.followupOf : ""})${notes ? " — " + notes.slice(0, 80) : ""}`,
      orderId: order.id,
    });

    // NOTE: Do NOT call triggerAutomation() here.
    // The Python order_watcher on the RDP polls for pending orders every 15s
    // and handles Dolphin startup + Playwright automation locally.
    // Calling triggerAutomation() would mark the order in_progress immediately,
    // preventing the Python watcher from ever picking it up.

    // Skip individual confirmation in silent (bulk) mode — caller sends a summary instead
    if (silent) return "created";

    const photoNote = (photoFileIds?.length ?? 0) > 0
      ? `\n📸 ${photoFileIds!.length} photo(s) attached` : "";
    const notesNote = notes ? `\n📝 <i>${escHtml(notes.slice(0, 120))}</i>` : "";

    // Build form data summary for the confirmation message
    let formDataNote = "";
    if (formCustomer?.allAnswers && Object.keys(formCustomer.allAnswers).length > 0) {
      const a = formCustomer.allAnswers;
      const lines: string[] = ["\n\n📋 <b>Form Submission Data</b>"];
      const fieldMap: [string[], string][] = [
        [["full_name", "customer_name", "name"], "👤 Name"],
        [["email", "customer_email"], "📧 Email"],
        [["phone", "customer_phone", "phone_number"], "📞 Phone"],
        [["shipping_address", "ship_address", "shipping_address_line1", "address"], "🚚 Shipping Address"],
        [["billing_address", "bill_address", "billing_address_line1"], "💳 Billing Address"],
        [["account_password", "password", "acc_password", "account_pass"], "🔑 Account Password"],
        [["anything_else", "additional_info", "notes", "comments", "message", "anything_we_should_know", "other_info"], "📌 Additional Info"],
      ];
      for (const [keys, label] of fieldMap) {
        const val = keys.map((k) => a[k]).find(Boolean);
        if (val) lines.push(`${label}: ${escHtml(String(val))}`);
      }
      // Include any remaining fields not already shown
      const shownKeys = new Set(fieldMap.flatMap(([keys]) => keys).concat(["order_ref", "order_number", "order_id", "order_no"]));
      for (const [k, v] of Object.entries(a)) {
        if (!shownKeys.has(k) && v) lines.push(`• ${escHtml(k.replace(/_/g, " "))}: ${escHtml(String(v))}`);
      }
      if (lines.length > 1) {
        const raw = lines.join("\n");
        // Truncate if close to Telegram's 4096-char limit to avoid rejection
        formDataNote = raw.length > 2000 ? raw.slice(0, 2000) + "\n…" : raw;
      }
    }

    const formMatchNote = formCustomer ? `\n🔗 <i>Customer matched from form</i>` : "";
    const customerNote = resolvedEmail
      ? `\n👤 ${escHtml(resolvedName || "Customer")} (${escHtml(resolvedEmail)}${resolvedPhone ? ` · ${escHtml(resolvedPhone)}` : ""})` : "";
    const followupNote = parsed.followupOf
      ? `\n🔁 <b>Following up on:</b> ${escHtml(issueLabels[parsed.followupOf] || parsed.followupOf)}`
      : parsed.followupNote
      ? `\n🔁 <b>Follow-up note:</b> ${escHtml(parsed.followupNote)}`
      : "";

    const msgId = await tgSend({
      text:
        `✅ <b>Order Queued</b>\n\n` +
        `🏪 <b>Store:</b> ${escHtml(parsed.merchantName)}\n` +
        `📦 <b>Order:</b> <code>${escHtml(parsed.orderNumber)}</code>\n` +
        `⚠️ <b>Issue:</b> ${escHtml(issueLabels[parsed.issueCode] || parsed.issueCode)}` +
        followupNote + formMatchNote + customerNote + notesNote + photoNote + formDataNote,
      parse_mode: "HTML",
    }, chatId);

    // Store the message_id so it can be deleted when the order is auto-deleted
    if (msgId) {
      await storage.updateRetailOrder(order.id, { telegramMessageId: String(msgId) });
    } else {
      // Confirmation failed — send a minimal plain-text fallback so user always gets a reply
      console.error(`[telegram-bot] Confirmation tgSend returned null for order ${parsed.orderNumber} — sending plain fallback`);
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (token) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `✅ Order queued: ${parsed.merchantName} ${parsed.orderNumber} (${parsed.issueCode})`,
          }),
        }).catch((e) => console.error("[telegram-bot] Plain fallback also failed:", e?.message));
      }
    }

    return "created";
  }, `createOrder:${parsed.orderNumber}`, 3, 500);

  if (result === null) {
    await tgSend({
      text: `❌ Failed to create order for ${escHtml(parsed.merchantName)} <code>${escHtml(parsed.orderNumber)}</code> after retries. Please try again.`,
      parse_mode: "HTML",
    }, chatId);
  }
}

// ─── Handle incoming updates ──────────────────────────────────────────────────

async function handleUpdate(update: any) {
  const updateType = Object.keys(update || {}).filter(k => k !== "update_id").join(",") || "unknown";
  const message = update?.message;
  if (!message) {
    console.log(`[telegram-bot] Skipping non-message update (type: ${updateType})`);
    return;
  }

  const chatId: number = message.chat.id;
  const text: string = message.text?.trim() ?? "";

  // ── Session expiry check ────────────────────────────────────────────────────
  const justExpired = checkSessionExpiry();
  if (justExpired) {
    await tgSend({
      text: `⏰ *Session expired*\n\nYour 5-hour session has ended. Please send the dashboard password to reactivate.`,
    }, chatId);
    // If the current message is a slash command let it fall through to be handled;
    // otherwise return so the expiry notice is the only reply.
    if (!text.startsWith("/")) return;
  }

  // ── Photo message ──────────────────────────────────────────────────────────
  if (message.photo?.length) {
    const best = message.photo[message.photo.length - 1];
    const fileId: string = best.file_id;
    const caption: string = message.caption?.trim() ?? "";
    const pending = pendingPhotoOrders.get(chatId);

    if (pending && pending.length > 0) {
      const photos = pendingPhotos.get(chatId) ?? [];
      photos.push(fileId);
      pendingPhotos.set(chatId, photos);

      if (caption) {
        const { orders: captionOrders, notes: captionNotes } = parseMessageText(caption);
        for (const o of captionOrders) {
          if (!pending.find((p) => p.orderNumber === o.orderNumber)) {
            pending.push({ ...o, chatId, ts: Date.now() });
          }
        }
        if (captionNotes) pending.forEach((p) => { if (!p.notes) p.notes = captionNotes; });
      }

      await tgSend({
        text: `📸 Photo received. Total: *${photos.length}* photo(s) for *${pending.length}* pending order(s).\n\nSend _done_ to confirm, or keep sending photos.`,
      }, chatId);
      return;
    }

    if (caption) {
      const { orders, notes } = parseMessageText(caption);
      for (const o of orders) {
        await createOrderFromParsed(o, chatId, notes || undefined, [fileId]);
      }
      if (orders.length === 0) {
        await tgSend({ text: `📸 Photo received but no order found in caption. Send your order first, then photos.` }, chatId);
      }
    } else {
      const photos = pendingPhotos.get(chatId) ?? [];
      photos.push(fileId);
      pendingPhotos.set(chatId, photos);
      await tgSend({ text: `📸 Photo stored. Send your order message now and it will be attached automatically.` }, chatId);
    }
    return;
  }

  // ── Text message ────────────────────────────────────────────────────────────

  // ── OTP reply capture — check before password gate ─────────────────────────
  const otpRequestId = otpWaitingChats.get(String(chatId));
  if (otpRequestId && text && !text.startsWith("/") && /^\d{4,8}$/.test(text)) {
    try {
      const otpReq = await storage.getOtpRequestById(otpRequestId);
      if (otpReq && otpReq.botStatus === "awaiting_code") {
        await storage.updateOtpRequest(otpRequestId, {
          botStatus: "code_provided",
          code: text,
          providedAt: new Date(),
        });
        otpWaitingChats.delete(String(chatId));
        await tgSend({ text: `✅ Code received — entering it now.` }, chatId);
        return;
      }
    } catch (e: any) {
      console.error("[otp] reply capture error:", e?.message);
    }
    otpWaitingChats.delete(String(chatId));
  }

  // ── Password gate: if awaiting activation password ─────────────────────────
  // Slash commands are always allowed through — only treat plain text as a password attempt.
  if (awaitingPassword && !text.startsWith("/")) {
    const messageId = message.message_id;

    // Delete the password message from chat immediately
    tgDeleteMessage(chatId, messageId).catch(() => {});

    const token = process.env.TELEGRAM_BOT_TOKEN!;
    const plainEnv = process.env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWROD;
    const passwordHash = process.env.DASHBOARD_PASSWORD_HASH;

    // Check plain text password FIRST (instant) — only fall back to slow bcrypt if needed
    const plainMatch = plainEnv ? text === plainEnv : false;
    const hashMatch = !plainMatch && passwordHash ? await bcrypt.compare(text, passwordHash) : false;
    // text is not retained after this point — only the boolean result is used.

    // Helper: send one message directly (no retry loops, no parse_mode complexity)
    const directSend = async (msg: string) => {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg }),
        });
        const d: any = await r.json();
        if (!d.ok) console.error("[telegram-bot] directSend failed:", d.description);
      } catch (e: any) {
        console.error("[telegram-bot] directSend error:", e?.message);
      }
    };

    if (plainMatch || hashMatch) {
      botAuthenticated = true;
      awaitingPassword = false;
      authTimestamp = Date.now();
      console.log("[telegram-bot] Session authenticated via Telegram");
      await directSend(
        "✅ Bot Activated — session open for 5 hours\n\n" +
        "Send an order:\n" +
        "Store OrderNumber IssueCode\n\n" +
        "Issue codes:\n" +
        "• DNA — Did Not Arrive\n" +
        "• EB — Empty Box\n" +
        "• LIT — Lost In Transit\n" +
        "• Step1 — Create Return\n" +
        "• Step2 — Return Not Processed\n" +
        "• Followup+DNA — Follow up with code\n" +
        "• Followup+refund not received — Follow up with note\n\n" +
        "Photos (optional): Send before an order to attach automatically\n\n" +
        "Commands:\n" +
        "/orders · /sessions · /stats · /status · /help"
      );
    } else {
      await directSend("❌ Wrong password. Try again.");
    }
    return;
  }

  // ── Slash commands ──────────────────────────────────────────────────────────
  if (text.startsWith("/")) {
    const cmd = text.split(" ")[0].toLowerCase();

    if (cmd === "/start") {
      if (!botAuthenticated) {
        awaitingPassword = true;
        await tgSend({
          text: `🔐 *Bot requires activation*\n\nPlease send the dashboard password to unlock.`,
        }, chatId);
      } else {
        await tgSend({
          text:
            `👋 *Order Bot — Active*\n\n` +
            `Send orders in this format:\n` +
            `\`<Store> <OrderNumber> <IssueCode>\`\n\n` +
            `*Issue Codes:*\n` +
            `• \`DNA\` — Did Not Arrive\n` +
            `• \`EB\` — Empty Box\n` +
            `• \`LIT\` — Lost In Transit\n` +
            `• \`Step1\` — Create Return\n` +
            `• \`Step2\` — Return Not Processed\n` +
            `• \`Followup+DNA\` — Follow up (code) or \`Followup+custom note\`\n\n` +
            `*Examples:*\n` +
            `\`Amazon 123-456-789 DNA\`\n` +
            `\`Nike AB123 Step1\`\n` +
            `\`Zara ORDER99 Step2\`\n\n` +
            `You can send multiple orders at once, one per line.`,
        }, chatId);
      }
      return;
    }

    if (cmd === "/help") {
      await tgSend({
        text:
          `📖 *Order Bot Help*\n\n` +
          `*Format:* \`<Store> <OrderNumber> <IssueCode>\`\n\n` +
          `*Issue Codes:*\n` +
          `• \`DNA\` — Did Not Arrive\n` +
          `• \`EB\` — Empty Box\n` +
          `• \`LIT\` — Lost In Transit\n` +
          `• \`Step1\` — Create Return\n` +
          `• \`Step2\` — Return Not Processed\n` +
          `• \`Followup+DNA\` — Follow up (with original code)\n` +
          `• \`Followup+refund not received\` — Follow up (custom note)\n\n` +
          `*Form-ID format:* \`<SubmissionID> <IssueCode>\`\n` +
          `_(paste the UUID from the dashboard — customer details auto-filled)_\n\n` +
          `*Bulk orders:* Send multiple lines at once\n` +
          `*Photos:* Send photos _before_ an order to attach them automatically\n\n` +
          `*Order management:*\n` +
          `• /status — live view of all active orders + current step\n` +
          `• /cancel <OrderNumber> — delete a stuck order\n` +
          `• /resubmit <OrderNumber> — clear and resend an order\n\n` +
          `*Status:* ${botAuthenticated ? "🟢 Active" : "🔴 Locked — send /start to activate"}`,
      }, chatId);
      return;
    }

    if (cmd === "/status") {
      if (!botAuthenticated) {
        await tgSend({ text: `🔴 *Bot is locked.* Send /start and enter the password to activate.` }, chatId);
        return;
      }
      try {
        const inProgress = await storage.getRetailOrders({ status: "in_progress" });
        const pending = await storage.getRetailOrders({ status: "pending" });

        let text = `🟢 *Bot is active* — session open\n\n`;

        const ageMin = (o: any) => Math.round((Date.now() - new Date(o.createdAt).getTime()) / 60000);
        const staleMin = 20; // warn if pending > 20 min with no update

        if (inProgress.length === 0 && pending.length === 0) {
          text += `📭 No active or pending orders right now.`;
        } else {
          if (inProgress.length > 0) {
            text += `⚙️ *In Progress (${inProgress.length}):*\n`;
            for (const o of inProgress) {
              const age = ageMin(o);
              const lastUpdate = Math.round((Date.now() - new Date(o.updatedAt).getTime()) / 60000);
              const stale = lastUpdate >= staleMin;
              text += `• *${o.merchantName}* \`${o.orderNumber}\` — ${o.issueType} _(${age}m ago)_\n`;
              if ((o as any).currentStep) {
                text += `  ↳ _${(o as any).currentStep}_`;
              } else {
                text += `  ↳ _Processing..._`;
              }
              if (stale) text += ` ⚠️ _No update for ${lastUpdate}m_`;
              text += `\n`;
            }
            text += `\n`;
          }
          if (pending.length > 0) {
            text += `🕐 *Queued (${pending.length}):*\n`;
            for (const o of pending) {
              const age = ageMin(o);
              const stale = age >= staleMin;
              text += `• *${o.merchantName}* \`${o.orderNumber}\` — ${o.issueType} _(waiting ${age}m)_`;
              if (stale) text += ` ⚠️`;
              text += `\n`;
            }
            text += `\n_Use /cancel <OrderNumber> to remove a stuck order_`;
          }
        }
        await tgSend({ text }, chatId);
      } catch (e) {
        await tgSend({ text: `🟢 *Bot is active.* Could not fetch order details.` }, chatId);
      }
      return;
    }

    if (cmd === "/orders") {
      if (!botAuthenticated) {
        awaitingPassword = true;
        await tgSend({ text: `🔐 *Bot is locked.* Send the password to activate.` }, chatId);
        return;
      }
      try {
        const [pending, inProgress] = await Promise.all([
          storage.getRetailOrders({ status: "pending" }),
          storage.getRetailOrders({ status: "in_progress" }),
        ]);
        const all = [...inProgress, ...pending];
        if (all.length === 0) {
          await tgSend({ text: `📦 *No active orders right now.*` }, chatId);
          return;
        }
        const statusIcon: Record<string, string> = {
          pending: "⏳", in_progress: "⚙️", resolved: "✅", failed: "❌",
        };
        const lines: string[] = [`📦 *Active Orders (${all.length})*\n`];
        for (const o of all.slice(0, 20)) {
          const icon = statusIcon[o.status] ?? "•";
          const customer = o.customerName ? ` — _${o.customerName}_` : "";
          const step = (o as any).currentStep ? `\n    ↳ _${(o as any).currentStep}_` : "";
          lines.push(`${icon} *${o.merchantName}* \`${o.orderNumber}\` · ${o.issueType}${customer}${step}`);
        }
        if (all.length > 20) lines.push(`\n_...and ${all.length - 20} more. See dashboard for full list._`);
        await tgSend({ text: lines.join("\n") }, chatId);
      } catch {
        await tgSend({ text: `❌ Failed to fetch orders.` }, chatId);
      }
      return;
    }

    if (cmd === "/cancel") {
      if (!botAuthenticated) {
        awaitingPassword = true;
        await tgSend({ text: `🔐 *Bot is locked.* Send the password to activate.` }, chatId);
        return;
      }
      const orderNum = text.split(" ").slice(1).join(" ").trim();
      if (!orderNum) {
        await tgSend({ text: `Usage: /cancel <OrderNumber>\nExample: /cancel 114-5551234-6789012` }, chatId);
        return;
      }
      try {
        const all = await storage.getRetailOrders({});
        const match = all.find((o) => o.orderNumber.toLowerCase() === orderNum.toLowerCase());
        if (!match) {
          await tgSend({ text: `❌ No order found with number \`${orderNum}\`\n\nUse /orders to see active orders.` }, chatId);
          return;
        }
        await storage.logRetailActivity({
          action: "order_cancelled",
          details: `Order ${match.orderNumber} (${match.merchantName}) cancelled via bot`,
          orderId: match.id,
        });
        if (match.telegramMessageId && match.telegramChatId) {
          await tgDeleteMessage(match.telegramChatId, match.telegramMessageId).catch(() => {});
        }
        await storage.deleteRetailOrder(match.id);
        await tgSend({
          text: `🗑️ *Order cancelled*\n\n*${match.merchantName}* \`${match.orderNumber}\` has been removed.`,
        }, chatId);
      } catch {
        await tgSend({ text: `❌ Failed to cancel order. Try again.` }, chatId);
      }
      return;
    }

    if (cmd === "/resubmit") {
      if (!botAuthenticated) {
        awaitingPassword = true;
        await tgSend({ text: `🔐 *Bot is locked.* Send the password to activate.` }, chatId);
        return;
      }
      const orderNum = text.split(" ").slice(1).join(" ").trim();
      if (!orderNum) {
        await tgSend({ text: `Usage: /resubmit <OrderNumber>\nThis removes the stuck order so you can resubmit it fresh.` }, chatId);
        return;
      }
      try {
        const all = await storage.getRetailOrders({});
        const match = all.find((o) => o.orderNumber.toLowerCase() === orderNum.toLowerCase());
        if (!match) {
          await tgSend({ text: `❌ No order found with number \`${orderNum}\`\n\nUse /orders to see active orders.` }, chatId);
          return;
        }
        const issueType = match.issueType;
        const merchant = match.merchantName;
        await storage.deleteRetailOrder(match.id);
        await tgSend({
          text:
            `♻️ *Order removed — ready to resubmit*\n\n` +
            `*${merchant}* \`${orderNum}\` (${issueType}) has been cleared.\n\n` +
            `Send it again:\n\`${merchant} ${orderNum} ${issueType}\``,
        }, chatId);
      } catch {
        await tgSend({ text: `❌ Failed to resubmit order. Try again.` }, chatId);
      }
      return;
    }

    if (cmd === "/sessions") {
      if (!botAuthenticated) {
        awaitingPassword = true;
        await tgSend({ text: `🔐 *Bot is locked.* Send the password to activate.` }, chatId);
        return;
      }
      try {
        const sessions = await storage.getRetailActiveSessions();
        if (sessions.length === 0) {
          await tgSend({ text: `🤖 *No active automation sessions.*` }, chatId);
          return;
        }
        const lines: string[] = [`🤖 *Active Sessions (${sessions.length})*\n`];
        for (const s of sessions.slice(0, 15)) {
          const order = s.orderId ? await storage.getRetailOrder(s.orderId) : null;
          const orderInfo = order ? `*${order.merchantName}* \`${order.orderNumber}\`` : `Order #${s.orderId ?? "?"}`;
          const step = order?.currentStep ? ` · _${order.currentStep}_` : "";
          const started = s.startedAt
            ? ` · ${Math.round((Date.now() - new Date(s.startedAt).getTime()) / 60000)}m ago`
            : "";
          lines.push(`⚙️ ${orderInfo}${step}${started}`);
        }
        if (sessions.length > 15) lines.push(`\n_...and ${sessions.length - 15} more._`);
        await tgSend({ text: lines.join("\n") }, chatId);
      } catch {
        await tgSend({ text: `❌ Failed to fetch sessions.` }, chatId);
      }
      return;
    }

    if (cmd === "/stats") {
      if (!botAuthenticated) {
        awaitingPassword = true;
        await tgSend({ text: `🔐 *Bot is locked.* Send the password to activate.` }, chatId);
        return;
      }
      try {
        const [s, activeSessions, recentActivity] = await Promise.all([
          storage.getRetailOrderStats(),
          storage.getRetailActiveSessions(),
          storage.getRetailActivity(5),
        ]);
        const completed = s.resolved + s.failed;
        const successRate = completed > 0 ? Math.round((s.resolved / completed) * 100) : 0;

        const activityLines = recentActivity.length > 0
          ? recentActivity.map((a) => `• ${a.details?.slice(0, 60) ?? a.action}`).join("\n")
          : "_No recent activity_";

        await tgSend({
          text:
            `📊 *Dashboard Stats*\n\n` +
            `*Orders*\n` +
            `• Total: *${s.total}*\n` +
            `• Pending: *${s.pending}*\n` +
            `• In Progress: *${s.inProgress}*\n` +
            `• Resolved: *${s.resolved}*\n` +
            `• Failed: *${s.failed}*\n` +
            `• Success Rate: *${successRate}%*\n\n` +
            `*Automation*\n` +
            `• Active Sessions: *${activeSessions.length}*\n\n` +
            `*Recent Activity*\n${activityLines}`,
        }, chatId);
      } catch {
        await tgSend({ text: `❌ Failed to fetch stats.` }, chatId);
      }
      return;
    }

    // All other slash commands silently ignored
    return;
  }

  // ── Require authentication for all order commands ───────────────────────────
  if (!botAuthenticated) {
    awaitingPassword = true;
    await tgSend({
      text: `🔐 *Bot is locked.* Please send the dashboard password to activate, then resend your order.`,
    }, chatId);
    return;
  }

  if (!text) {
    console.log(`[telegram-bot] Empty text message received (chatId=${chatId}) — ignoring`);
    return;
  }

  if (text.toLowerCase() === "done") {
    const pending = pendingPhotoOrders.get(chatId);
    const photos = pendingPhotos.get(chatId) ?? [];
    if (pending && pending.length > 0) {
      if (photos.length === 0) {
        await tgSend({ text: `❌ No photos received yet. Please send photos before confirming.` }, chatId);
        return;
      }
      await Promise.all(pending.map((o) => createOrderFromParsed(o, chatId, o.notes, photos)));
      pendingPhotoOrders.delete(chatId);
      pendingPhotos.delete(chatId);
      await tgSend({ text: `✅ *${pending.length}* Step1 order(s) created with *${photos.length}* photo(s) attached.` }, chatId);
    } else {
      await tgSend({ text: `No pending orders to confirm.` }, chatId);
    }
    return;
  }

  console.log(`[telegram-bot] Processing message (chatId=${chatId}, auth=${botAuthenticated}): "${text.slice(0, 60)}"`);
  const { orders: rawOrders, notes } = parseMessageText(text);
  if (rawOrders.length === 0) {
    console.log(`[telegram-bot] No orders parsed from: "${text.slice(0, 80)}"`);
    await tgSend({
      text:
        `❓ *Couldn't read that as an order.*\n\n` +
        `*Standard format:*\n` +
        `\`<Store> <OrderNumber> <IssueCode>\`\n\n` +
        `*Form-ID format:*\n` +
        `\`<FormSubmissionID> <IssueCode>\`\n\n` +
        `*Examples:*\n` +
        `\`Nike 123-456 DNA\`\n` +
        `\`Amazon B09XYZ Followup+DNA\`\n` +
        `\`550e8400-e29b-41d4-a716-446655440000 Step1\`\n\n` +
        `Send /help for all issue codes.`,
    }, chatId);
    return;
  }

  // ── Resolve form-ID orders (UUID format) ─────────────────────────────────────
  const orders: ParsedOrderLine[] = [];
  for (const o of rawOrders) {
    if (!o.formResponseId) {
      orders.push(o);
      continue;
    }
    const formData = await findFormDataByResponseId(o.formResponseId);
    if (!formData) {
      await tgSend({ text: `❌ Form submission \`${o.formResponseId.slice(0, 8)}…\` not found.` }, chatId);
      continue;
    }
    if (!formData.orderNumber) {
      await tgSend({ text: `⚠️ Submission \`${o.formResponseId.slice(0, 8)}…\` has no order number — skipping.` }, chatId);
      continue;
    }
    orders.push({
      ...o,
      merchantName: formData.merchantName || "Unknown",
      orderNumber: formData.orderNumber,
      customerName: o.customerName || formData.customerName,
      customerEmail: o.customerEmail || formData.customerEmail,
    });
  }
  if (orders.length === 0) return;

  const storedPhotos = pendingPhotos.get(chatId) ?? [];
  const step1Orders = orders.filter((o) => o.issueCode === "Step1");
  const normalOrders = orders.filter((o) => o.issueCode !== "Step1");

  const isBulk = orders.length > 1;

  if (normalOrders.length > 0) {
    await Promise.all(
      normalOrders.map((o) => createOrderFromParsed(
        o, chatId, notes || undefined,
        storedPhotos.length > 0 ? storedPhotos : undefined,
        isBulk,   // silent = true for bulk — no per-order messages
      ))
    );
    if (storedPhotos.length > 0) pendingPhotos.delete(chatId);
  }

  if (step1Orders.length > 0) {
    // Step1 orders are created immediately regardless of whether photos are present.
    // Photos are optional — if the user sent photos before the order they will be
    // attached automatically; otherwise the order proceeds without them.
    await Promise.all(step1Orders.map((o) => createOrderFromParsed(
      o, chatId, notes || undefined,
      storedPhotos.length > 0 ? storedPhotos : undefined,
      isBulk,
    )));
    if (storedPhotos.length > 0) pendingPhotos.delete(chatId);
  }

  if (isBulk) {
    const readyCount = orders.length;
    await tgSend({
      text: `✅ *${readyCount} order(s) located and proceeding with processing.*\n\n_Live updates will follow for each order._`,
    }, chatId);
  }
}

// ─── Cleanup expired pending orders ──────────────────────────────────────────

function cleanupExpired() {
  const now = Date.now();
  for (const [chatId, pending] of pendingPhotoOrders.entries()) {
    const active = pending.filter((p) => now - p.ts <= PHOTO_WAIT_MS);
    const expired = pending.filter((p) => now - p.ts > PHOTO_WAIT_MS);
    if (expired.length > 0) {
      if (active.length === 0) {
        pendingPhotoOrders.delete(chatId);
        pendingPhotos.delete(chatId);
      } else {
        pendingPhotoOrders.set(chatId, active);
      }
      tgSend({
        text: `⏰ *Photo timeout* — ${expired.length} Step1 order(s) expired. Resubmit with photos attached.`,
      }, chatId).catch(() => {});
    }
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function pollLoop() {
  let consecutiveErrors = 0;

  while (pollingActive) {
    const updates = await getUpdates();

    if (updates.length > 0) {
      consecutiveErrors = 0;
      for (const update of updates) {
        pollingOffset = update.update_id + 1;
        handleUpdate(update).catch((e) =>
          console.error("[telegram-bot] Handler error:", e)
        );
      }
    } else {
      consecutiveErrors++;
      // After 10 consecutive empty/error polls add progressive backoff
      const delay = consecutiveErrors > 10
        ? Math.min(30000, 3000 * Math.floor(consecutiveErrors / 10))
        : 3000;
      await new Promise((r) => setTimeout(r, delay));
    }

    cleanupExpired();
  }
}

/** Secret used to validate incoming webhook requests from Telegram. */
export function getWebhookSecret(token: string): string {
  return require("crypto").createHash("sha256").update(token).digest("hex").slice(0, 32);
}

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[telegram-bot] No TELEGRAM_BOT_TOKEN configured — skipping");
    return;
  }

  // Register the command menu (shows in Telegram's / button)
  await registerBotCommands(token);

  // Reset session state on every restart — admin must re-authenticate
  botAuthenticated = false;
  awaitingPassword = true;

  // Start OTP background listener
  otpListener();
  console.log("[telegram-bot] OTP listener started");

  // ── Decide: webhook (production with domain) or long-polling (everywhere else) ──
  const domain = (
    process.env.PUBLIC_DOMAIN ||
    (process.env.NODE_ENV === "production"
      ? (process.env.REPLIT_DOMAINS || "").split(",")[0]
      : "")
  ).trim();

  if (domain) {
    // Webhook mode — Telegram pushes updates to our HTTPS endpoint
    const webhookUrl = `https://${domain}/api/telegram/webhook`;
    const secret = getWebhookSecret(token);
    const ok = await setWebhook(token, webhookUrl, secret);
    if (ok) {
      console.log(`[telegram-bot] Webhook registered: ${webhookUrl}`);
      console.log("[telegram-bot] Waiting for password activation from admin");
      return;
    }
    console.warn("[telegram-bot] Webhook registration failed — falling back to polling");
  }

  // Polling mode — clear any existing webhook first to avoid 409 conflicts
  await clearWebhook(token);
  console.log("[telegram-bot] Starting long-poll loop");
  console.log("[telegram-bot] Waiting for password activation from admin");

  pollingActive = true;
  pollLoop().catch((e) => console.error("[telegram-bot] pollLoop crashed:", e));
}

export function stopTelegramBot() {
  pollingActive = false;
}
