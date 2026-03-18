import type { Express, Request, Response as ExpressResponse, NextFunction } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import { encrypt } from "../crypto";
import { z } from "zod";
import { registerRetailRoutes } from "./retail";
import { startTelegramBot, dispatchWebhookUpdate, getWebhookSecret, tgSend } from "../telegram-bot";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c statement_timeout=0",
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function sendTelegramMessage(payload: object): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping notification");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, parse_mode: "HTML", ...payload }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[telegram] API error ${res.status}: ${body}`);
      return false;
    }
    console.log("[telegram] Message sent successfully");
    return true;
  } catch (e) {
    console.error("[telegram] Network error:", e);
    return false;
  }
}

async function sendTelegramNotification(responseId: string, createdAt: Date) {
  const dateStr = createdAt.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  await sendTelegramMessage({
    text:
      `🔔 <b>New Order Submission</b>\n\n` +
      `📋 ID: <code>${responseId}</code>\n` +
      `🕐 Time: ${dateStr}\n\n` +
      `<i>Open your dashboard to view and decrypt this response.</i>`,
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegramEditNotification(
  responseId: string,
  fieldLabel: string,
  fieldValue: string
) {
  await sendTelegramMessage({
    text:
      `✏️ <b>Response Edited</b>\n\n` +
      `📋 ID: <code>${escHtml(responseId)}</code>\n` +
      `🔧 Field: <b>${escHtml(fieldLabel)}</b>\n` +
      `📝 New value: <code>${escHtml(String(fieldValue).slice(0, 200))}</code>\n\n` +
      `<i>Tap Sync to update the matching order in the bot.</i>`,
    reply_markup: {
      inline_keyboard: [[
        {
          text: "🔄 Sync Order",
          callback_data: `sync_response:${responseId}`,
        },
      ]],
    },
  });
}

const PgSession = connectPgSimple(session);

// These match the live database exactly — update here whenever questions are changed via the form editor
// so that fresh installs (new DB / new deploy) get the correct questions automatically.
const DEFAULT_QUESTIONS = [
  { pageNumber: 1, sortOrder:  1, questionId: "agreement",         questionText: "Do you agree?",                            questionType: "radio",    options: ["Yes", "No"],                                                                              required: true,  placeholder: null,                                            description: "IMPORTANT PLEASE READ\n\n⚠️ DO NOT FILL THIS FORM IF EVERY SINGLE ITEM FROM YOUR ORDER IS NOT YET FULLY DELIVERED. BY FILING THIS FORM YOU AGREE THE MINIMUM FEE PAYABLE TO US IS 100 $ € £ FOR EACH ORDER SUBMITTED!\n\n⚠️ DO NOT TURN ON DEVICES TILL YOU GET REFUND!" },
  { pageNumber: 2, sortOrder:  2, questionId: "order_ref",          questionText: "Order Reference / ID",                     questionType: "text",     options: null,                                                                                       required: true,  placeholder: "e.g. ORD-123456",                               description: "Your order reference number or ID from the platform" },
  { pageNumber: 2, sortOrder:  3, questionId: "order_date",         questionText: "Date of Order",                            questionType: "date",     options: null,                                                                                       required: true,  placeholder: null,                                            description: null },
  { pageNumber: 2, sortOrder:  4, questionId: "platform",           questionText: "Platform / Website Purchased From",        questionType: "url",      options: null,                                                                                       required: true,  placeholder: "e.g. Amazon, eBay, AliExpress",                description: null },
  { pageNumber: 2, sortOrder:  5, questionId: "order_value",        questionText: "Total Order Value",                        questionType: "text",     options: null,                                                                                       required: true,  placeholder: "e.g. $250.00",                                  description: "Include the currency symbol" },
  { pageNumber: 3, sortOrder:  6, questionId: "item_description",   questionText: "Item(s) Description",                     questionType: "textarea", options: null,                                                                                       required: true,  placeholder: "Describe each item in your order",              description: "List all items included in this order" },
  { pageNumber: 3, sortOrder:  7, questionId: "quantity",           questionText: "Total Quantity of Items",                  questionType: "number",   options: null,                                                                                       required: true,  placeholder: "e.g. 3",                                        description: null },
  { pageNumber: 3, sortOrder:  8, questionId: "condition",          questionText: "Condition of Items Received",              questionType: "select",   options: ["New / Sealed", "Open Box", "Damaged / Defective", "Wrong Item Received", "Missing Items", "Other"], required: true, placeholder: null, description: null },
  { pageNumber: 3, sortOrder:  9, questionId: "serial_numbers",     questionText: "Serial Numbers (if applicable)",           questionType: "textarea", options: null,                                                                                       required: false, placeholder: "List serial numbers for each device",           description: "Leave blank if not applicable" },
  { pageNumber: 4, sortOrder: 10, questionId: "claim_reason",       questionText: "Reason for Submission",                   questionType: "textarea", options: null,                                                                                       required: true,  placeholder: "Describe the issue or reason for this submission", description: null },
  { pageNumber: 4, sortOrder: 11, questionId: "contacted_seller",   questionText: "Have you contacted the original seller?", questionType: "radio",    options: ["Yes", "No", "Not Applicable"],                                                           required: true,  placeholder: null,                                            description: null },
  { pageNumber: 4, sortOrder: 12, questionId: "evidence_notes",     questionText: "Additional Notes / Evidence Details",     questionType: "textarea", options: null,                                                                                       required: false, placeholder: "Any tracking numbers, screenshots, or additional info", description: null },
  { pageNumber: 5, sortOrder: 13, questionId: "full_name",          questionText: "Full Name",                               questionType: "text",     options: null,                                                                                       required: true,  placeholder: "Your full legal name",                          description: null },
  { pageNumber: 5, sortOrder: 14, questionId: "email",              questionText: "Email Address",                           questionType: "email",    options: null,                                                                                       required: true,  placeholder: "your@email.com",                                description: null },
  { pageNumber: 5, sortOrder: 15, questionId: "phone",              questionText: "Phone Number",                            questionType: "phone",    options: null,                                                                                       required: false, placeholder: "+1 234 567 8900",                               description: null },
  { pageNumber: 5, sortOrder: 16, questionId: "contact_method",     questionText: "Preferred Contact Method",                questionType: "select",   options: ["Email", "Phone", "WhatsApp", "Telegram"],                                                required: true,  placeholder: null,                                            description: null },
  { pageNumber: 5, sortOrder: 17, questionId: "telegram_username",  questionText: "Telegram Username",                       questionType: "text",     options: null,                                                                                       required: false, placeholder: "@your_username",                                description: "Enter your Telegram username starting with @. Only required if you selected Telegram as your contact method." },
  { pageNumber: 5, sortOrder: 18, questionId: "refund_details",     questionText: "Payment / Refund Details",                questionType: "textarea", options: null,                                                                                       required: true,  placeholder: "Bank account, PayPal email, crypto address, etc.", description: "Provide details for how you would like to receive your refund" },
];

// ─── Rate limiters (brute-force / abuse prevention) ──────────────────────────

// Login: max 10 attempts per 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Form submission: max 15 submissions per hour per IP
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: { message: "Too many submissions. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: 300 requests per 15 min per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Input sanitization helper ────────────────────────────────────────────────
function sanitizeString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  // Strip HTML tags to prevent stored XSS
  return value
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

function deepSanitize(obj: unknown): unknown {
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(deepSanitize);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = deepSanitize(v);
    }
    return result;
  }
  return obj;
}

// Bcrypt hash of the dashboard password, computed once at startup.
// We hash even plain-text env passwords so all comparisons go through
// bcrypt — the original plain text is never stored or compared directly.
let _dashboardPasswordHash: string | null = null;

async function getDashboardPasswordHash(): Promise<string | null> {
  if (_dashboardPasswordHash) return _dashboardPasswordHash;

  // Prefer a pre-hashed value stored in DASHBOARD_PASSWORD_HASH
  const preHashed = process.env.DASHBOARD_PASSWORD_HASH;
  if (preHashed) {
    _dashboardPasswordHash = preHashed;
    return _dashboardPasswordHash;
  }

  // Fall back to plain-text secret — hash it once and cache
  const plain = process.env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWROD;
  if (plain) {
    _dashboardPasswordHash = await bcrypt.hash(plain, 12);
    console.log("[auth] Dashboard password hashed and cached in memory");
    return _dashboardPasswordHash;
  }

  return null;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Trust exactly 1 proxy hop (Replit's TLS-terminating load balancer)
  app.set("trust proxy", 1);

  // Apply general API rate limiter to all /api routes
  app.use("/api", apiLimiter);

  app.use(
    session({
      store: new PgSession({ pool, tableName: "session", createTableIfMissing: true }),
      name: "sid",
      secret: process.env.SESSION_SECRET || "fallback_secret_change_me",
      resave: false,
      rolling: true,
      saveUninitialized: false,
      cookie: {
        // On Replit the dev URL is always HTTPS, and the workspace embeds the app
        // in a cross-site iframe — SameSite:None + Secure is required for cookies
        // to be sent in that cross-site context.
        secure: !!(process.env.REPL_ID || process.env.NODE_ENV === "production"),
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        sameSite: process.env.REPL_ID ? "none" : "lax",
      },
    })
  );

  await seedDefaultQuestions();

  registerRetailRoutes(app);
  await startTelegramBot();

  // ── Telegram webhook endpoint (production only) ──────────────────────────
  // Telegram calls this URL instead of us polling, eliminating 409 conflicts.
  app.post("/api/telegram/webhook", async (req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) { res.sendStatus(403); return; }

    // Validate the secret header Telegram sends with every update
    const expected = getWebhookSecret(token);
    const received = req.headers["x-telegram-bot-api-secret-token"];
    if (received !== expected) {
      console.warn("[telegram-webhook] Invalid secret token — ignoring update");
      res.sendStatus(403);
      return;
    }

    // Acknowledge immediately, then process in background
    res.sendStatus(200);
    dispatchWebhookUpdate(req.body);
  });

  // CORS for cross-origin requests (includes credentialed requests from the Replit workspace iframe)
  app.use("/api", (req: Request, res: ExpressResponse, next: NextFunction) => {
    const configuredOrigin = process.env.FORMS_ALLOWED_ORIGIN;
    const requestOrigin = req.headers.origin || "";
    // Must reflect a specific origin (not *) when Allow-Credentials is true
    if (configuredOrigin) {
      res.setHeader("Access-Control-Allow-Origin", configuredOrigin);
    } else if (requestOrigin) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    }
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    next();
  });

  const requireAuth = (req: Request, res: ExpressResponse, next: () => void) => {
    // Accept API key from external dashboard (main app)
    const apiKey = Array.isArray(req.headers["x-api-key"]) ? req.headers["x-api-key"][0] : req.headers["x-api-key"];
    const configuredKey = process.env.FORMS_API_KEY;
    if (configuredKey && apiKey === configuredKey) {
      return next();
    }
    // Fall back to session auth
    if ((req.session as any).authenticated) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized" }); return;
  };

  app.get("/api/form/config", async (_req, res) => {
    try {
      const questions = await storage.getFormQuestions();
      res.json({ questions });
    } catch (e) {
      res.status(500).json({ message: "Failed to load form" });
    }
  });

  app.post("/api/v1/submit", submitLimiter, async (req, res) => {
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWROD;
    if (!encryptionKey) {
      res.status(500).json({ message: "Server configuration error" }); return;
    }

    const body = z.object({ data: z.string().min(1) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: "Invalid submission" }); return;
    }

    try {
      const encryptedData = encrypt(body.data.data, encryptionKey);
      const response = await storage.createResponse({ encryptedData });
      
      res.json({ ok: true, id: response.id });

      sendTelegramNotification(response.id, response.createdAt).then(() => {
        storage.markTelegramNotified(response.id).catch(() => {});
      });
    } catch (e) {
      res.status(500).json({ message: "Submission failed" });
    }
  });

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      res.status(500).json({ message: "Server configuration error: ENCRYPTION_KEY missing" }); return;
    }

    const passwordHash = await getDashboardPasswordHash();
    if (!passwordHash) {
      res.status(500).json({ message: "Server configuration error: DASHBOARD_PASSWORD missing" }); return;
    }

    const body = z.object({ password: z.string() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "Invalid" }); return; }

    const match = await bcrypt.compare(body.data.password, passwordHash);

    if (match) {
      (req.session as any).authenticated = true;
      res.json({ ok: true, encryptionKey });
    } else {
      await new Promise((r) => setTimeout(r, 300));
      res.status(401).json({ message: "Incorrect password" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  app.get("/api/auth/check", (req, res) => {
    const authenticated = !!(req.session as any).authenticated;
    if (!authenticated) {
      res.json({ authenticated: false }); return;
    }
    const encryptionKey = process.env.ENCRYPTION_KEY;
    const legacyKey = process.env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWROD || null;
    res.json({ authenticated: true, encryptionKey, legacyKey });
  });

  app.get("/api/data/responses", requireAuth, async (_req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const allResponses = await storage.getAllResponses();
      const notesMap: Record<string, string> = {};

      await Promise.all(
        allResponses.map(async (r) => {
          const note = await storage.getNote(r.id);
          if (note) notesMap[r.id] = note.encryptedNote;
        })
      );

      res.json({
        responses: allResponses.map((r) => ({
          id: r.id,
          encryptedData: r.encryptedData,
          createdAt: r.createdAt,
          telegramNotified: r.telegramNotified,
          encryptedNote: notesMap[r.id] || null,
        })),
      });
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch responses" });
    }
  });

  app.delete("/api/data/responses/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteResponse(req.params.id as string);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: "Failed to delete" });
    }
  });

  app.delete("/api/data/responses", requireAuth, async (_req, res) => {
    try {
      const count = await storage.deleteAllResponses();
      res.json({ ok: true, count });
    } catch (e) {
      res.status(500).json({ message: "Failed to delete all responses" });
    }
  });

  app.put("/api/data/responses/:id", requireAuth, async (req, res) => {
    const body = z.object({
      encryptedData: z.string(),
      fieldLabel: z.string().optional(),
      fieldValue: z.string().optional(),
    }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "Invalid body" }); return; }
    try {
      const updated = await storage.updateResponseEncryptedData(req.params.id as string, body.data.encryptedData);
      res.json({ ok: true, id: updated.id });
      // Fire Telegram edit notification in background
      if (body.data.fieldLabel) {
        sendTelegramEditNotification(
          updated.id,
          body.data.fieldLabel,
          body.data.fieldValue ?? ""
        ).catch(() => {});
      }
    } catch (e) {
      res.status(500).json({ message: "Failed to update response" });
    }
  });

  app.put("/api/data/responses/:id/note", requireAuth, async (req, res) => {
    const body = z.object({ encryptedNote: z.string() }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "Invalid" }); return; }

    try {
      const note = await storage.upsertNote({
        responseId: req.params.id as string,
        encryptedNote: body.data.encryptedNote,
      });
      res.json({ ok: true, note });
    } catch (e) {
      res.status(500).json({ message: "Failed to save note" });
    }
  });

  app.delete("/api/data/responses/:id/note", requireAuth, async (req, res) => {
    try {
      await storage.deleteNote(req.params.id as string);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: "Failed to delete note" });
    }
  });

  app.post("/api/data/import", requireAuth, async (req, res) => {
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWROD;
    if (!encryptionKey) { res.status(500).json({ message: "Server configuration error" }); return; }

    const body = z.object({
      rows: z.array(z.record(z.string(), z.string())).min(1).max(500),
    }).safeParse(req.body);

    if (!body.success) { res.status(400).json({ message: "Invalid import data" }); return; }

    const DATE_KEYS = ["order_date", "date", "created_at", "createdAt", "submitted_at", "submittedAt", "timestamp"];
    function extractDate(row: Record<string, string>): Date | null {
      for (const key of DATE_KEYS) {
        const val = row[key];
        if (!val) continue;
        const d = new Date(val);
        if (!isNaN(d.getTime()) && d.getTime() > 0) return d;
      }
      return null;
    }

    try {
      const rowsWithDates = body.data.rows.map((row) => ({
        row,
        date: extractDate(row),
      }));
      rowsWithDates.sort((a, b) => {
        const ta = a.date?.getTime() ?? Infinity;
        const tb = b.date?.getTime() ?? Infinity;
        return ta - tb;
      });

      const ids: string[] = [];
      for (const { row, date } of rowsWithDates) {
        const encryptedData = encrypt(JSON.stringify({ answers: row }), encryptionKey);
        const insertData: Record<string, unknown> = { encryptedData, telegramNotified: true };
        if (date) insertData.createdAt = date;
        const response = await storage.createResponse(insertData as any);
        ids.push(response.id);
      }
      res.json({ ok: true, count: ids.length });
    } catch (e) {
      res.status(500).json({ message: "Import failed" });
    }
  });

  app.get("/api/data/questions", requireAuth, async (_req, res) => {
    try {
      const questions = await storage.getFormQuestions();
      res.json({ questions });
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch questions" });
    }
  });

  app.get("/api/form/settings", async (_req, res) => {
    try {
      const endPageText = await storage.getFormSetting("end_page_text");
      res.json({ end_page_text: endPageText || "" });
    } catch (e) {
      res.json({ end_page_text: "" });
    }
  });

  app.put("/api/data/form-settings", requireAuth, async (req, res) => {
    const body = z.object({ end_page_text: z.string().max(2000) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ message: "Invalid" }); return; }
    try {
      await storage.setFormSetting("end_page_text", body.data.end_page_text);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  app.get("/api/data/telegram-diagnose", requireAuth, async (_req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token) { res.json({ ok: false, error: "TELEGRAM_BOT_TOKEN is not set" }); return; }
    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const me = await meRes.json() as any;
      if (!me.ok) { res.json({ ok: false, error: `Invalid bot token: ${me.description}`, configuredChatId: chatId || "(not set)" }); return; }

      const updatesRes = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=20`);
      const updates = await updatesRes.json() as any;
      const seenChats: { id: number; type: string; title?: string; username?: string }[] = [];
      if (updates.ok && updates.result) {
        for (const u of updates.result) {
          const chat = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat;
          if (chat && !seenChats.find((c) => c.id === chat.id)) {
            seenChats.push({ id: chat.id, type: chat.type, title: chat.title, username: chat.username });
          }
        }
      }
      res.json({
        ok: true,
        bot: { id: me.result.id, username: me.result.username, name: me.result.first_name },
        configuredChatId: chatId || "(not set)",
        seenChats,
        hint: seenChats.length === 0
          ? "No recent chats found. Send a message to your bot or in the target group/channel, then click Diagnose again."
          : `Found ${seenChats.length} chat(s). Use the 'id' as TELEGRAM_CHAT_ID (groups are negative numbers).`,
      });
    } catch (e) {
      res.json({ ok: false, error: String(e) });
    }
  });

  app.post("/api/data/test-notification", requireAuth, async (_req, res) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      res.status(500).json({ message: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured in environment secrets" });
      return;
    }
    const ok = await sendTelegramMessage({
      text: "🧪 <b>Test Notification</b>\n\nYour Telegram integration is working correctly.",
    });
    if (ok) {
      res.json({ ok: true });
    } else {
      res.status(500).json({ message: "Telegram API rejected the message — check server logs for the exact error (wrong chat ID, bot not in chat, etc.)" });
    }
  });

  app.put("/api/data/questions", requireAuth, async (req, res) => {
    const body = z.object({
      questions: z.array(
        z.object({
          pageNumber: z.number(),
          questionId: z.string(),
          questionText: z.string(),
          questionType: z.string(),
          options: z.array(z.string()).nullable().optional(),
          required: z.boolean().optional(),
          sortOrder: z.number(),
          placeholder: z.string().nullable().optional(),
          description: z.string().nullable().optional(),
        })
      ),
    }).safeParse(req.body);

    if (!body.success) { res.status(400).json({ message: "Invalid questions" }); return; }

    try {
      const questions = await storage.replaceFormQuestions(body.data.questions as any);
      res.json({ ok: true, questions });
    } catch (e) {
      res.status(500).json({ message: "Failed to update questions" });
    }
  });

  app.get("/api/data/db-export", requireAuth, async (_req, res) => {
    try {
      const [questions, responses, endPageText] = await Promise.all([
        storage.getFormQuestions(),
        storage.getAllResponses(),
        storage.getFormSetting("end_page_text").catch(() => ""),
      ]);
      const payload = {
        exported_at: new Date().toISOString(),
        version: 1,
        form_settings: { end_page_text: endPageText || "" },
        form_questions: questions,
        responses,
      };
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", `attachment; filename="secure-response-hub-backup-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json(payload);
    } catch (e) {
      res.status(500).json({ message: "Export failed" });
    }
  });

  return httpServer;
}

async function seedDefaultQuestions() {
  try {
    const existing = await storage.getFormQuestions();
    if (existing.length === 0) {
      await storage.replaceFormQuestions(DEFAULT_QUESTIONS as any);
      console.log("[seed] Default form questions seeded");
    }
  } catch (e) {
    console.error("[seed] Failed to seed questions:", e);
  }
}
