import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { dispatch as captchaDispatch, getBalance as captchaBalance } from "../captcha";
import {
  pingDolphin,
  listProfiles,
  createProfile,
  startProfile,
  stopProfile,
  applyProxyToProfile,
  getDolphinBaseUrl,
  type DolphinProfile,
} from "../dolphin";

function requireAuth(req: Request, res: Response, next: () => void) {
  const apiKey = Array.isArray(req.headers["x-api-key"])
    ? req.headers["x-api-key"][0]
    : req.headers["x-api-key"];
  const configuredKey = process.env.FORMS_API_KEY;
  if (configuredKey && apiKey === configuredKey) return next();
  if ((req.session as any)?.authenticated) return next();
  return res.status(401).json({ message: "Unauthorized" });
}

const ISSUE_CODES = ["DNA", "EB", "Step1", "Step2", "LIT", "Followup"] as const;
const VALID_STATUSES = ["pending", "in_progress", "awaiting_followup", "resolved", "failed", "escalated"] as const;

// ─── Telegram helpers (shared) ───────────────────────────────────────────────

/** Escape characters that have special meaning in Telegram HTML mode. */
function escHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function sendTelegramRetailMessage(payload: object) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...payload }),
    });
  } catch (e) {
    console.error("[retail] Telegram send failed:", e);
  }
}

/** Send a message to a specific chatId (HTML mode), returns the new message_id or null. */
async function tgSend(chatId: string | number, text: string): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", text }),
    });
    const data: any = await res.json();
    if (data.ok) return data.result.message_id as number;
    console.error(`[retail] tgSend failed: ${data.description ?? "unknown"} — retrying plain text`);
    // HTML parse failure — retry without formatting
    const res2 = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data2: any = await res2.json();
    if (!data2.ok) console.error(`[retail] tgSend plain-text retry also failed: ${data2.description ?? "unknown"}`);
    return data2.ok ? (data2.result.message_id as number) : null;
  } catch (e) {
    console.error("[retail] tgSend error:", e);
    return null;
  }
}

/** Edit an existing Telegram message (HTML mode). Returns true on success. */
async function tgEditMessage(chatId: string | number, messageId: number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId || !messageId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, parse_mode: "HTML", text }),
    });
    const data: any = await res.json();
    if (!data.ok) {
      // Edit failed (message too old, deleted, unchanged) — send a new message instead
      console.warn(`[retail] tgEditMessage failed (${data.description}) — sending new message`);
      const newId = await tgSend(chatId, text);
      return newId !== null;
    }
    return true;
  } catch {
    return false;
  }
}

async function deleteTelegramMessage(chatId: string | number, messageId: string | number): Promise<void> {
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

/** Build the live-update card text for an in-progress order (HTML mode). */
function buildLiveCard(order: any, step: string, isError = false): string {
  const icon = isError ? "❌" : "⚙️";
  const statusLine = isError
    ? `<b>Error:</b> ${escHtml(step)}`
    : `<b>Step:</b> ${escHtml(step)}`;
  return (
    `${icon} <b>AutoResolve — Live Update</b>\n\n` +
    `🏪 <b>Store:</b> ${escHtml(order.merchantName)}\n` +
    `📦 <b>Order:</b> <code>${escHtml(order.orderNumber)}</code>\n` +
    `⚠️ <b>Issue:</b> ${escHtml(order.issueType)}\n\n` +
    `${statusLine}`
  );
}

/** Delete the previous live card and send a fresh one at the bottom of chat.
 *  This keeps the latest status always at the bottom so the user sees it
 *  without scrolling — matches "delete previous message after each update". */
async function pushLiveUpdate(order: any, step: string, isError = false): Promise<void> {
  const chatId = order.telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;
  const text = buildLiveCard(order, step, isError);

  // Delete the previous live card (best-effort)
  if (order.liveMessageId) {
    await deleteTelegramMessage(chatId, Number(order.liveMessageId));
  }

  // Send a fresh card at the bottom of the chat
  const newMsgId = await tgSend(chatId, text);

  // Persist the new message ID
  if (newMsgId) {
    await storage.updateRetailOrder(order.id, { liveMessageId: String(newMsgId) } as any);
  }
}

// ─── Shape transformers (DB camelCase ↔ API snake_case) ──────────────────────

function orderToApi(o: any) {
  return {
    id: o.id,
    order_number: o.orderNumber,
    merchant_name: o.merchantName,
    region: o.region,
    issue_type: o.issueType,
    desired_outcome: o.desiredOutcome,
    status: o.status,
    notes: o.notes ?? null,
    current_step: o.currentStep ?? null,
    customer_name: o.customerName ?? null,
    customer_email: o.customerEmail ?? null,
    photo_file_ids: o.photoFileIds ?? [],
    telegram_chat_id: o.telegramChatId ?? null,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

function merchantToApi(m: any) {
  return {
    id: m.id,
    name: m.name,
    region: m.region,
    live_chat_available: m.liveChatAvailable ?? true,
    notes: m.notes ?? null,
    dolphin_profile_id: m.dolphinProfileId ?? null,
    created_at: m.createdAt,
  };
}

function sessionToApi(s: any) {
  return {
    id: s.id,
    order_id: s.orderId,
    status: s.status,
    started_at: s.startedAt ?? null,
    ended_at: s.completedAt ?? null,
    notes: s.notes ?? null,
    browser_profile_id: s.dolphinProfileId ?? null,
    dolphin_ws_url: s.dolphinWsUrl ?? null,
    created_at: s.createdAt,
  };
}

function activityToApi(a: any) {
  return {
    id: a.id,
    action: a.action,
    details: a.details ?? null,
    order_id: a.orderId ?? null,
    session_id: a.sessionId ?? null,
    timestamp: a.timestamp,
  };
}

// ─── Shared: trigger automation for an order ─────────────────────────────────

/**
 * Resolve the Dolphin profile ID to use for a given merchant.
 *
 * Strategy (one profile per merchant):
 *  1. Look the merchant up by name in the DB.
 *  2. If the merchant record already has a dolphinProfileId → reuse it.
 *  3. If not → create a brand-new Dolphin profile named after the merchant,
 *     persist the ID on the merchant record, then use it.
 *  4. Fallback: if the merchant is unknown to the DB and Dolphin is unreachable,
 *     return the global DOLPHIN_PROFILE_ID env var (if set) as a last resort.
 */
async function resolveProfileForMerchant(
  merchantName: string,
): Promise<number | null> {
  // ── 1. Look up merchant ────────────────────────────────────────────────────
  let merchant = await storage.getRetailMerchantByName(merchantName);

  // ── 2. Merchant already has a dedicated profile ────────────────────────────
  if (merchant?.dolphinProfileId) {
    const id = parseInt(merchant.dolphinProfileId, 10);
    if (!Number.isNaN(id)) return id;
  }

  // ── 3. Create a new profile for this merchant ──────────────────────────────
  try {
    const newProfileId = await createProfile(merchantName);
    console.log(`[automation] Created Dolphin profile #${newProfileId} for merchant "${merchantName}"`);

    if (merchant) {
      // Persist onto existing merchant record
      await storage.updateRetailMerchant(merchant.id, {
        dolphinProfileId: String(newProfileId),
      } as any);
    } else {
      // Auto-create the merchant record while we're here
      const newMerchant = await storage.createRetailMerchant({
        name: merchantName,
        region: "usa",
        liveChatAvailable: true,
        dolphinProfileId: String(newProfileId),
      } as any);
      console.log(`[automation] Auto-created merchant record "${merchantName}" (id: ${newMerchant.id})`);
    }

    return newProfileId;
  } catch (e: any) {
    console.warn(`[automation] Could not create Dolphin profile for "${merchantName}": ${e.message}`);
  }

  // ── 4. Global fallback ────────────────────────────────────────────────────
  const fallback = process.env.DOLPHIN_PROFILE_ID;
  if (fallback) {
    const id = parseInt(fallback, 10);
    if (!Number.isNaN(id)) return id;
  }

  return null;
}

export async function triggerAutomation(orderId: string): Promise<void> {
  const order = await storage.getRetailOrder(orderId);
  if (!order || order.status !== "pending") return;

  // ── Resolve the Dolphin profile for this merchant ─────────────────────────
  const profileId = await resolveProfileForMerchant(order.merchantName);

  // ── Dolphin not available — queue for manual pickup ───────────────────────
  if (!profileId) {
    await storage.logRetailActivity({
      action: "automation_queued",
      details: `Order queued — no Dolphin profile available for "${order.merchantName}"`,
      orderId: order.id,
    });
    await pushLiveUpdate(order, "Order queued — waiting for RDP automation pickup");
    return;
  }

  // ── Guard: check if this profile is already busy with another order ────────
  const activeSessions = await storage.getRetailActiveSessions();
  const profileBusy = activeSessions.some(
    (s) => s.dolphinProfileId === String(profileId),
  );
  if (profileBusy) {
    await storage.logRetailActivity({
      action: "automation_queued",
      details: `Profile #${profileId} busy — order queued for "${order.merchantName}" #${order.orderNumber}`,
      orderId: order.id,
    });
    await pushLiveUpdate(
      order,
      `Profile #${profileId} is busy — order queued until it's free`,
    );
    return;
  }

  // ── Start the Dolphin session ─────────────────────────────────────────────
  try {
    await pushLiveUpdate(order, `Starting Dolphin profile #${profileId} for ${order.merchantName}…`);

    // Push proxy credentials into the profile before launching
    await applyProxyToProfile(profileId).catch((e: Error) =>
      console.warn("[automation] proxy apply skipped:", e.message),
    );

    const { wsEndpoint } = await startProfile(profileId);

    // Record the session
    const session = await storage.createRetailSession({
      orderId: order.id,
      status: "running",
      startedAt: new Date(),
      dolphinProfileId: String(profileId),
      dolphinWsUrl: wsEndpoint,
    });

    // Mark order in-progress
    await storage.updateRetailOrder(order.id, { status: "in_progress" } as any);

    await storage.logRetailActivity({
      action: "automation_started",
      details: `Dolphin profile #${profileId} started for ${order.merchantName} — CDP: ${wsEndpoint}`,
      orderId: order.id,
      sessionId: session.id,
    });

    await pushLiveUpdate(
      { ...order, status: "in_progress" },
      `Dolphin live — profile #${profileId} (${order.merchantName})`,
    );

    console.log(`[automation] session ${session.id} | order ${orderId} | profile #${profileId} | ${wsEndpoint}`);
  } catch (e: any) {
    console.error("[automation] Failed to start Dolphin:", e.message);
    await storage.logRetailActivity({
      action: "automation_error",
      details: `Dolphin start failed for ${order.merchantName}: ${e.message}`,
      orderId: order.id,
    });
    await pushLiveUpdate(order, `Dolphin start failed: ${e.message}`, true);
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerRetailRoutes(app: Express) {

  // ─── Stats ─────────────────────────────────────────────────────────────────

  app.get("/api/retail/orders/stats", requireAuth, async (_req, res) => {
    try {
      const s = await storage.getRetailOrderStats();
      const activeSessions = await storage.getRetailActiveSessions();
      const completed = s.resolved + s.failed;
      const successRate = completed > 0 ? Math.round((s.resolved / completed) * 100) : 0;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const allOrders = await storage.getRetailOrders();
      const todayOrders = allOrders.filter((o) => new Date(o.createdAt) >= todayStart).length;
      const todayResolved = allOrders.filter((o) => o.status === "resolved" && new Date(o.updatedAt) >= todayStart).length;

      res.json({
        total_orders: s.total,
        pending_orders: s.pending,
        in_progress_orders: s.inProgress,
        resolved_orders: s.resolved,
        failed_orders: s.failed,
        active_sessions: activeSessions.length,
        today_orders: todayOrders,
        today_resolved: todayResolved,
        success_rate: successRate,
      });
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch stats" });
    }
  });

  // ─── Orders ────────────────────────────────────────────────────────────────

  app.get("/api/retail/orders", requireAuth, async (req, res) => {
    try {
      const { status, merchant, search, issue_type, region } = req.query as Record<string, string>;
      const orders = await storage.getRetailOrders({
        status: status || undefined,
        merchantName: merchant || search || undefined,
        issueType: issue_type || undefined,
        region: region || undefined,
      });
      res.json(orders.map(orderToApi));
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  app.post("/api/retail/orders", requireAuth, async (req, res) => {
    const body = z.object({
      order_number: z.string().min(1),
      merchant_name: z.string().min(1),
      region: z.string().default("usa"),
      issue_type: z.string().min(1),
      desired_outcome: z.string().default("Refund"),
      status: z.string().default("pending"),
      notes: z.string().optional(),
      photo_file_ids: z.array(z.string()).optional(),
      telegram_chat_id: z.string().optional(),
      customer: z.object({
        name: z.string().optional(),
        email: z.string().optional(),
      }).optional(),
    }).safeParse(req.body);

    if (!body.success) { res.status(400).json({ message: "Invalid order data" }); return; }

    try {
      const d = body.data;
      const order = await storage.createRetailOrder({
        orderNumber: d.order_number,
        merchantName: d.merchant_name,
        region: d.region,
        issueType: d.issue_type,
        desiredOutcome: d.desired_outcome,
        status: d.status,
        notes: d.notes,
        photoFileIds: d.photo_file_ids ?? [],
        telegramChatId: d.telegram_chat_id,
        customerName: d.customer?.name,
        customerEmail: d.customer?.email,
      });
      await storage.logRetailActivity({
        action: "order_created",
        details: `Order ${order.orderNumber} created for ${order.merchantName} (${order.issueType})`,
        orderId: order.id,
      });
      res.json(orderToApi(order));
    } catch (e) {
      res.status(500).json({ message: "Failed to create order" });
    }
  });

  app.get("/api/retail/orders/:id", requireAuth, async (req, res) => {
    try {
      const order = await storage.getRetailOrder(req.params.id as string);
      if (!order) { res.status(404).json({ message: "Order not found" }); return; }
      res.json(orderToApi(order));
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch order" });
    }
  });

  app.patch("/api/retail/orders/:id", requireAuth, async (req, res) => {
    const body = z.object({
      status: z.string().optional(),
      notes: z.string().optional(),
      desired_outcome: z.string().optional(),
      customer_name: z.string().optional(),
      customer_email: z.string().optional(),
    }).safeParse(req.body);

    if (!body.success) { res.status(400).json({ message: "Invalid update data" }); return; }

    try {
      const d = body.data;
      const order = await storage.updateRetailOrder(req.params.id as string, {
        status: d.status,
        notes: d.notes,
        desiredOutcome: d.desired_outcome,
        customerName: d.customer_name,
        customerEmail: d.customer_email,
      });
      if (d.status) {
        await storage.logRetailActivity({
          action: "status_changed",
          details: `Order ${order.orderNumber} status → ${d.status}`,
          orderId: order.id,
        });
      }
      res.json(orderToApi(order));

      // Send Telegram status notification for any status change
      if (d.status) {
        setImmediate(async () => {
          try {
            const statusLabel = d.status!.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            await pushLiveUpdate(order, `Status changed → ${statusLabel}`);

            if (d.status === "resolved" || d.status === "failed") {
              await new Promise(r => setTimeout(r, 5000));
              if (order.telegramChatId && order.telegramMessageId) {
                await deleteTelegramMessage(order.telegramChatId, order.telegramMessageId);
              }
              await storage.logRetailActivity({
                action: "order_auto_deleted",
                details: `Order ${order.orderNumber} (${order.merchantName}) auto-deleted after ${d.status}`,
              });
              await storage.deleteRetailOrder(order.id);
            }
          } catch { /* silent */ }
        });
      }
    } catch (e) {
      res.status(500).json({ message: "Failed to update order" });
    }
  });

  // ─── Step update (called by automation to report live progress) ───────────

  app.post("/api/retail/orders/:id/step", requireAuth, async (req, res) => {
    const body = z.object({
      step: z.string().min(1),
      is_error: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "step required" }); return; }

    try {
      const order = await storage.getRetailOrder(req.params.id as string);
      if (!order) { res.status(404).json({ message: "Order not found" }); return; }

      const { step, is_error } = body.data;

      // Persist current step
      await storage.updateRetailOrder(order.id, { currentStep: step } as any);

      // Log the step
      await storage.logRetailActivity({
        action: is_error ? "automation_error" : "automation_step",
        details: `[${order.merchantName} ${order.orderNumber}] ${step}`,
        orderId: order.id,
      });

      // Push / edit live Telegram card
      await pushLiveUpdate({ ...order, currentStep: step }, step, is_error ?? false);

      res.json({ ok: true });
    } catch (e) {
      console.error("[retail] step update error:", e);
      res.status(500).json({ message: "Failed to update step" });
    }
  });

  app.delete("/api/retail/orders/:id", requireAuth, async (req, res) => {
    try {
      const order = await storage.getRetailOrder(req.params.id as string);
      if (!order) { res.status(404).json({ message: "Order not found" }); return; }
      await storage.deleteRetailOrder(req.params.id as string);
      await storage.logRetailActivity({
        action: "order_deleted",
        details: `Order ${order.orderNumber} (${order.merchantName}) deleted`,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: "Failed to delete order" });
    }
  });

  // ─── Start Automation (called by dashboard with order_id in body) ──────────

  app.post("/api/retail/automation/start", requireAuth, async (req, res) => {
    const body = z.object({ order_id: z.string().min(1) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "order_id required" }); return; }

    try {
      const order = await storage.getRetailOrder(body.data.order_id);
      if (!order) { res.status(404).json({ message: "Order not found" }); return; }

      // If already in_progress, still push a fresh live card so the dashboard trigger
      // is always reflected in Telegram even for already-running orders.
      if (order.status !== "pending") {
        await pushLiveUpdate(order, "Automation manually re-triggered...");
        res.json({ success: true, session_id: null });
        return;
      }

      await triggerAutomation(order.id);
      res.json({ success: true, session_id: null });
    } catch (e) {
      res.status(500).json({ message: "Failed to start automation" });
    }
  });

  // ─── Per-order start (keep for direct REST usage) ─────────────────────────

  app.post("/api/retail/orders/:id/start-automation", requireAuth, async (req, res) => {
    try {
      const order = await storage.getRetailOrder(req.params.id as string);
      if (!order) { res.status(404).json({ message: "Order not found" }); return; }
      if (order.status !== "pending") {
        await pushLiveUpdate(order, "Automation manually re-triggered...");
        res.json({ success: true, session_id: null });
        return;
      }
      await triggerAutomation(order.id);
      res.json({ success: true, session_id: null });
    } catch (e) {
      res.status(500).json({ message: "Failed to start automation" });
    }
  });

  // ─── Merchants ─────────────────────────────────────────────────────────────

  app.get("/api/retail/merchants", requireAuth, async (_req, res) => {
    try {
      const merchants = await storage.getRetailMerchants();
      res.json(merchants.map(merchantToApi));
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch merchants" });
    }
  });

  app.post("/api/retail/merchants", requireAuth, async (req, res) => {
    const body = z.object({
      name: z.string().min(1),
      region: z.string().default("usa"),
      live_chat_available: z.boolean().default(true),
      notes: z.string().optional(),
    }).safeParse(req.body);

    if (!body.success) { res.status(400).json({ message: "Invalid merchant data" }); return; }

    try {
      const d = body.data;
      const merchant = await storage.createRetailMerchant({
        name: d.name,
        region: d.region,
        liveChatAvailable: d.live_chat_available,
        notes: d.notes,
      });
      await storage.logRetailActivity({ action: "merchant_added", details: `Merchant ${merchant.name} added` });
      res.json(merchantToApi(merchant));
    } catch (e) {
      res.status(500).json({ message: "Failed to create merchant" });
    }
  });

  app.post("/api/retail/merchants/import/known", requireAuth, async (_req, res) => {
    const KNOWN_MERCHANTS = [
      { name: "Amazon", region: "usa", liveChatAvailable: true },
      { name: "Best Buy", region: "usa", liveChatAvailable: true },
      { name: "Walmart", region: "usa", liveChatAvailable: true },
      { name: "Target", region: "usa", liveChatAvailable: true },
      { name: "Costco", region: "usa", liveChatAvailable: false },
      { name: "eBay", region: "usa", liveChatAvailable: true },
      { name: "Newegg", region: "usa", liveChatAvailable: true },
      { name: "B&H Photo", region: "usa", liveChatAvailable: true },
      { name: "Apple", region: "usa", liveChatAvailable: true },
      { name: "Samsung", region: "usa", liveChatAvailable: true },
    ];
    try {
      const existing = await storage.getRetailMerchants();
      const existingNames = new Set(existing.map((m) => m.name.toLowerCase()));
      let added = 0;
      for (const m of KNOWN_MERCHANTS) {
        if (!existingNames.has(m.name.toLowerCase())) {
          await storage.createRetailMerchant(m);
          added++;
        }
      }
      res.json({ success: true, imported: added });
    } catch (e) {
      res.status(500).json({ message: "Failed to import merchants" });
    }
  });

  app.delete("/api/retail/merchants/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteRetailMerchant(req.params.id as string);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: "Failed to delete merchant" });
    }
  });

  // ─── Sessions ──────────────────────────────────────────────────────────────

  app.get("/api/retail/sessions", requireAuth, async (req, res) => {
    try {
      const { orderId, order_id } = req.query as Record<string, string>;
      const sessions = await storage.getRetailSessions(orderId || order_id || undefined);
      res.json(sessions.map(sessionToApi));
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch sessions" });
    }
  });

  app.get("/api/retail/sessions/active", requireAuth, async (_req, res) => {
    try {
      const sessions = await storage.getRetailActiveSessions();
      res.json(sessions.map(sessionToApi));
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch active sessions" });
    }
  });

  /** Complete or update a session — used by the dashboard and automation scripts */
  app.patch("/api/retail/sessions/:id", requireAuth, async (req, res) => {
    const sessionId = req.params.id as string;
    const body = z.object({
      status: z.enum(["running", "completed", "failed", "stopped"]).optional(),
      notes: z.string().optional(),
    }).safeParse(req.body);

    if (!body.success) { res.status(400).json({ message: "Invalid session update" }); return; }

    try {
      const update: Record<string, unknown> = {};
      if (body.data.status) update.status = body.data.status;
      if (body.data.notes !== undefined) update.notes = body.data.notes;

      // Set completedAt when finishing a session
      const finishing = body.data.status && ["completed", "failed", "stopped"].includes(body.data.status);
      if (finishing) update.completedAt = new Date();

      const session = await storage.updateRetailSession(sessionId, update as any);

      // If the session is tied to an order, reflect status back on the order
      if (finishing && session.orderId) {
        const orderStatus =
          body.data.status === "completed" ? "resolved" :
          body.data.status === "failed"    ? "failed"   : "pending";
        await storage.updateRetailOrder(session.orderId, { status: orderStatus } as any);
        const order = await storage.getRetailOrder(session.orderId);
        if (order) {
          await pushLiveUpdate(
            order,
            body.data.status === "completed"
              ? "Automation completed — order resolved"
              : body.data.status === "failed"
              ? "Automation failed"
              : "Automation stopped",
            body.data.status === "failed",
          );
        }
      }

      await storage.logRetailActivity({
        action: "session_updated",
        details: `Session ${sessionId} → ${body.data.status ?? "updated"}${body.data.notes ? ": " + body.data.notes.slice(0, 80) : ""}`,
        sessionId,
        orderId: session.orderId ?? undefined,
      });

      res.json(sessionToApi(session));
    } catch (e) {
      res.status(500).json({ message: "Failed to update session" });
    }
  });

  // ─── Activity ──────────────────────────────────────────────────────────────

  app.get("/api/retail/activity/recent", requireAuth, async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || "50", 10);
      const activity = await storage.getRetailActivity(limit);
      res.json(activity.map(activityToApi));
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch activity" });
    }
  });

  app.get("/api/retail/activity", requireAuth, async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || "50", 10);
      const activity = await storage.getRetailActivity(limit);
      res.json(activity.map(activityToApi));
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch activity" });
    }
  });

  // ─── System Status ─────────────────────────────────────────────────────────

  app.get("/api/retail/system/status", requireAuth, async (_req, res) => {
    const dolphin_connected = await pingDolphin();
    const proxy_configured = !!(process.env.PROXY_HOST && process.env.PROXY_PORT);
    res.json({
      telegram_connected: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      encryption_ready: true,
      dolphin_connected,
      proxy_configured,
      dolphin_url: getDolphinBaseUrl(),
      dolphin_profile_id: process.env.DOLPHIN_PROFILE_ID ?? null,
    });
  });

  // ─── Dolphin Anty Integration ───────────────────────────────────────────────

  /** Test connectivity to the Dolphin API */
  app.post("/api/retail/dolphin/test", requireAuth, async (_req, res) => {
    try {
      const ok = await pingDolphin();
      res.json({ connected: ok, url: getDolphinBaseUrl() });
    } catch (e: any) {
      res.json({ connected: false, url: getDolphinBaseUrl(), error: e.message });
    }
  });

  /** List browser profiles */
  app.get("/api/retail/dolphin/profiles", requireAuth, async (req, res) => {
    try {
      const page = parseInt((req.query.page as string) || "0", 10);
      const per_page = parseInt((req.query.per_page as string) || "50", 10);
      const result = await listProfiles(page, per_page);
      res.json(result);
    } catch (e: any) {
      res.status(502).json({ message: `Dolphin API error: ${e.message}` });
    }
  });

  /** Start a browser profile */
  app.post("/api/retail/dolphin/profiles/:profileId/start", requireAuth, async (req, res) => {
    const profileId = parseInt(req.params.profileId as string, 10);
    if (Number.isNaN(profileId)) { res.status(400).json({ message: "Invalid profileId" }); return; }
    try {
      const headless = req.body?.headless === true;
      const result = await startProfile(profileId, headless);
      await storage.logRetailActivity({
        action: "dolphin_profile_started",
        details: `Profile #${profileId} started manually — CDP: ${result.wsEndpoint}`,
      });
      res.json(result);
    } catch (e: any) {
      res.status(502).json({ message: `Failed to start profile: ${e.message}` });
    }
  });

  /** Stop a browser profile */
  app.post("/api/retail/dolphin/profiles/:profileId/stop", requireAuth, async (req, res) => {
    const profileId = parseInt(req.params.profileId as string, 10);
    if (Number.isNaN(profileId)) { res.status(400).json({ message: "Invalid profileId" }); return; }
    try {
      await stopProfile(profileId);
      await storage.logRetailActivity({
        action: "dolphin_profile_stopped",
        details: `Profile #${profileId} stopped manually`,
      });
      res.json({ stopped: true });
    } catch (e: any) {
      res.status(502).json({ message: `Failed to stop profile: ${e.message}` });
    }
  });

  // ─── OTP requests ─────────────────────────────────────────────────────────
  //  RDP automation creates a request when it hits a verification page.
  //  POST /api/retail/otp           { order_id, platform, otp_destination? }
  //  GET  /api/retail/otp/:orderId  poll for code_provided status
  //  PATCH /api/retail/otp/:id      mark expired / retry

  app.post("/api/retail/otp", requireAuth, async (req, res) => {
    const body = z.object({
      order_id: z.string(),
      platform: z.string(),
      otp_destination: z.string().optional(),
      retry: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "Invalid OTP request data" }); return; }
    try {
      const req2 = await storage.createOtpRequest({
        orderId: body.data.order_id,
        platform: body.data.platform,
        otpDestination: body.data.otp_destination ?? null,
        retry: body.data.retry ?? false,
        botStatus: "pending",
      });
      res.json({ id: req2.id, status: req2.botStatus });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to create OTP request" });
    }
  });

  app.get("/api/retail/otp/:orderId", requireAuth, async (req, res) => {
    try {
      const otp = await storage.getOtpRequestByOrder(req.params.orderId);
      if (!otp) { res.status(404).json({ message: "No active OTP request" }); return; }
      res.json({
        id: otp.id,
        status: otp.botStatus,
        code: otp.botStatus === "code_provided" ? otp.code : null,
      });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to fetch OTP request" });
    }
  });

  app.patch("/api/retail/otp/:id", requireAuth, async (req, res) => {
    const body = z.object({
      bot_status: z.string(),
      retry: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "Invalid update" }); return; }
    try {
      const updated = await storage.updateOtpRequest(req.params.id, {
        botStatus: body.data.bot_status,
        ...(body.data.retry !== undefined ? { retry: body.data.retry } : {}),
      });
      res.json({ id: updated.id, status: updated.botStatus });
    } catch (e: any) {
      res.status(500).json({ message: "Failed to update OTP request" });
    }
  });

  // ─── Captcha solver ────────────────────────────────────────────────────────
  //  Called by the relay agent / automation scripts during a browser session.
  //  POST /api/retail/captcha/solve  { type, ...params }
  //  GET  /api/retail/captcha/balance

  app.get("/api/retail/captcha/balance", requireAuth, async (_req, res) => {
    try {
      const balance = await captchaBalance();
      res.json({ balance });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/retail/captcha/solve", requireAuth, async (req, res) => {
    if (!req.body?.type) {
      res.status(400).json({ message: "type is required (e.g. recaptchav2, hcaptcha, turnstile, image, ...)" });
      return;
    }
    const startedAt = Date.now();
    try {
      const result = await captchaDispatch(req.body);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[captcha] solved ${req.body.type} in ${elapsed}s`);
      res.json({ ok: true, result, elapsed_s: parseFloat(elapsed) });
    } catch (e: any) {
      console.error("[captcha] solve failed:", e.message);
      res.status(500).json({ ok: false, message: e.message });
    }
  });
}

// ─── Parse automation message from Telegram ─────────────────────────────────

export function parseAutomationMessage(text: string): {
  merchantName: string;
  orderNumber: string;
  issueCode: string;
} | null {
  const normalizedCodes = ISSUE_CODES.map((c) => c.toLowerCase());
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 3) return null;

  const lastToken = tokens[tokens.length - 1];
  const issueIndex = normalizedCodes.indexOf(lastToken.toLowerCase());
  if (issueIndex === -1) return null;

  const issueCode = ISSUE_CODES[issueIndex];
  const orderNumber = tokens[tokens.length - 2];
  const merchantName = tokens.slice(0, tokens.length - 2).join(" ");

  if (!merchantName || !orderNumber) return null;

  return { merchantName, orderNumber, issueCode };
}
