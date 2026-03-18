/**
 * AutoResolve Relay Agent
 * Run this on the RDP machine alongside start-relay.bat.
 * Bridges refundgod.fans → Dolphin Anty local API (localhost:3001).
 *
 * Dolphin's local API only accepts connections from localhost, so this relay
 * runs ON the RDP and forwards commands from your production server.
 *
 * Setup: see deploy/start-relay.bat — fill in your values and double-click it.
 * Alternatively: node relay-agent.cjs (with env vars already set)
 *
 * NOTE: Named .cjs to avoid ESM conflicts when run inside the project folder.
 */

const http = require("http");
const https = require("https");
const url = require("url");

// ── Config (override with env vars) ──────────────────────────────────────────
const DOLPHIN        = "http://127.0.0.1:3001";
const PORT           = Number(process.env.RELAY_PORT ?? 4001);
const SECRET         = process.env.RELAY_SECRET ?? "";
const TOKEN          = process.env.DOLPHIN_API_TOKEN ?? "";
const PROXY_HOST     = process.env.PROXY_HOST ?? "";
const PROXY_PORT     = process.env.PROXY_PORT ?? "";
const PROXY_USER     = process.env.PROXY_USER ?? "";
const PROXY_PASS     = process.env.PROXY_PASS ?? "";
const PROXY_TYPE     = process.env.PROXY_TYPE ?? "socks5";
const CAPTCHA_KEY    = process.env.TWOCAPTCHA_API_KEY ?? "";

const TWOCAPTCHA_BASE    = "https://2captcha.com";
const CAPTCHA_POLL_MS    = 3000;
const CAPTCHA_TIMEOUT_MS = 120000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fetchJson(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: opts.method || "GET",
      headers: opts.headers || {},
    };
    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function dolphin(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const result = await fetchJson(DOLPHIN + "/v1.0" + path, { ...opts, headers });
  return result.body;
}

async function ensureLoggedIn() {
  if (!TOKEN) return;
  await dolphin("/auth/login-with-token", {
    method: "POST",
    body: JSON.stringify({ token: TOKEN }),
  });
}

// ── 2captcha solver (zero dependencies, pure Node.js) ─────────────────────────

function fetchText(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(urlStr);
    const lib = parsed.protocol === "https:" ? https : http;
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: opts.method || "GET",
      headers: opts.headers || {},
    };
    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function captchaSubmit(params) {
  if (!CAPTCHA_KEY) throw new Error("TWOCAPTCHA_API_KEY not set in relay");
  const form = new URLSearchParams({ key: CAPTCHA_KEY, json: "1", ...params });
  const { body } = await fetchText(`${TWOCAPTCHA_BASE}/in.php`, {
    method: "POST",
    body: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data = JSON.parse(body);
  if (data.status !== 1) throw new Error("2captcha submit: " + data.request);
  return String(data.request);
}

async function captchaPoll(taskId) {
  const deadline = Date.now() + CAPTCHA_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, CAPTCHA_POLL_MS));
    const { body } = await fetchText(
      `${TWOCAPTCHA_BASE}/res.php?key=${CAPTCHA_KEY}&action=get&id=${taskId}&json=1`,
    );
    const data = JSON.parse(body);
    if (data.status === 1) return data.request;
    if (data.request !== "CAPCHA_NOT_READY")
      throw new Error("2captcha poll: " + data.request);
  }
  throw new Error("2captcha timed out after 120s");
}

async function solveCaptcha(params) {
  const taskId = await captchaSubmit(params);
  console.log("[captcha] submitted task:", taskId);
  const token = await captchaPoll(taskId);
  console.log("[captcha] solved:", taskId);
  return token;
}

async function dispatchCaptcha(req) {
  const t = req.type;
  if (!t) throw new Error("type is required");
  if (t === "balance") {
    const { body } = await fetchText(
      `${TWOCAPTCHA_BASE}/res.php?key=${CAPTCHA_KEY}&action=getbalance&json=1`,
    );
    const d = JSON.parse(body);
    if (d.status !== 1) throw new Error("Balance check: " + d.request);
    return { balance: parseFloat(d.request) };
  }
  let params = {};
  if (t === "recaptchav2") {
    params = { method: "userrecaptcha", googlekey: req.sitekey, pageurl: req.pageurl,
      ...(req.invisible ? { invisible: "1" } : {}),
      ...(req.enterprise ? { enterprise: "1" } : {}),
      ...(req.data_s ? { "data-s": req.data_s } : {}) };
  } else if (t === "recaptchav3") {
    params = { method: "userrecaptcha", version: "v3", googlekey: req.sitekey, pageurl: req.pageurl,
      ...(req.action ? { action: req.action } : {}),
      ...(req.min_score != null ? { min_score: String(req.min_score) } : {}),
      ...(req.enterprise ? { enterprise: "1" } : {}) };
  } else if (t === "hcaptcha") {
    params = { method: "hcaptcha", sitekey: req.sitekey, pageurl: req.pageurl,
      ...(req.invisible ? { invisible: "1" } : {}) };
  } else if (t === "turnstile") {
    params = { method: "turnstile", sitekey: req.sitekey, pageurl: req.pageurl,
      ...(req.action ? { action: req.action } : {}),
      ...(req.cdata ? { cdata: req.cdata } : {}) };
  } else if (t === "image") {
    params = { method: "base64", body: req.body || req.url,
      ...(req.phrase ? { phrase: "1" } : {}),
      ...(req.case ? { regsense: "1" } : {}),
      ...(req.numeric != null ? { numeric: String(req.numeric) } : {}),
      ...(req.hint ? { textinstructions: req.hint } : {}) };
  } else if (t === "funcaptcha") {
    params = { method: "funcaptcha", publickey: req.publickey, pageurl: req.pageurl,
      ...(req.surl ? { surl: req.surl } : {}),
      ...(req.data ? { data: req.data } : {}) };
  } else if (t === "geetest") {
    params = { method: "geetest", gt: req.gt, challenge: req.challenge, pageurl: req.pageurl };
  } else if (t === "geetestv4") {
    params = { method: "geetest_v4", captcha_id: req.captcha_id, pageurl: req.pageurl };
  } else if (t === "amazon_waf") {
    params = { method: "amazon_waf", sitekey: req.sitekey, iv: req.iv, context: req.context, pageurl: req.pageurl };
  } else if (t === "datadome") {
    params = { method: "datadome", captcha_url: req.captcha_url, pageurl: req.pageurl,
      userAgent: req.userAgent, proxy: req.proxy, proxytype: req.proxytype || "HTTPS" };
  } else if (t === "text") {
    params = { method: "post", textcaptcha: req.textcaptcha };
  } else if (t === "temu") {
    params = { method: "temu", app_id: req.app_id, nonce: req.nonce, pageurl: req.pageurl,
      ...(req.userAgent ? { userAgent: req.userAgent } : {}) };
  } else {
    throw new Error("Unknown captcha type: " + t);
  }
  const result = await solveCaptcha(params);
  return { result };
}

// ── Routing ───────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

function send(res, status, data) {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
    res.end(); return;
  }

  // Auth
  if (SECRET) {
    const key = req.headers["x-relay-secret"];
    if (key !== SECRET) { send(res, 401, { error: "Unauthorized" }); return; }
  }

  const { pathname } = new url.URL(req.url, "http://localhost");
  const method = req.method;

  try {
    // GET /health
    if (method === "GET" && pathname === "/health") {
      send(res, 200, { ok: true, relay: "AutoResolve", ts: new Date().toISOString() });
      return;
    }

    // GET /dolphin-ping
    if (method === "GET" && pathname === "/dolphin-ping") {
      await ensureLoggedIn();
      const data = await dolphin("/browser_profiles?page=0&per_page=1");
      send(res, 200, { ok: true, dolphin: data });
      return;
    }

    // GET /profiles
    if (method === "GET" && pathname === "/profiles") {
      await ensureLoggedIn();
      const data = await dolphin("/browser_profiles?page=0&per_page=50");
      send(res, 200, data);
      return;
    }

    // POST /profiles
    if (method === "POST" && pathname === "/profiles") {
      const body = await readBody(req);
      if (!body.name) { send(res, 400, { error: "name required" }); return; }
      await ensureLoggedIn();
      const proxy = (PROXY_HOST && PROXY_PORT) ? {
        type: PROXY_TYPE, host: PROXY_HOST, port: Number(PROXY_PORT),
        ...(PROXY_USER ? { login: PROXY_USER, password: PROXY_PASS } : {}),
      } : undefined;
      const data = await dolphin("/browser_profiles", {
        method: "POST",
        body: JSON.stringify({
          name: body.name,
          browserType: "anty", os: "windows",
          useragent: { mode: "auto" }, webrtc: { mode: "altered" },
          canvas: { mode: "real" }, webgl: { mode: "noise" },
          timezone: { mode: "auto" }, locale: { mode: "auto" },
          tags: ["autoresolve"],
          ...(proxy ? { proxy } : {}),
        }),
      });
      send(res, 200, data);
      return;
    }

    // POST /profiles/:id/proxy
    const proxyMatch = pathname.match(/^\/profiles\/(\d+)\/proxy$/);
    if (method === "POST" && proxyMatch) {
      if (!PROXY_HOST || !PROXY_PORT) { send(res, 400, { error: "Proxy not configured" }); return; }
      await ensureLoggedIn();
      const data = await dolphin(`/browser_profiles/${proxyMatch[1]}`, {
        method: "PATCH",
        body: JSON.stringify({
          proxy: {
            type: PROXY_TYPE, host: PROXY_HOST, port: Number(PROXY_PORT),
            ...(PROXY_USER ? { login: PROXY_USER, password: PROXY_PASS } : {}),
          },
        }),
      });
      send(res, 200, data);
      return;
    }

    // POST /profiles/:id/start
    const startMatch = pathname.match(/^\/profiles\/(\d+)\/start$/);
    if (method === "POST" && startMatch) {
      const body = await readBody(req);
      const headless = body?.headless ? 1 : 0;
      await ensureLoggedIn();
      const data = await dolphin(
        `/browser_profiles/${startMatch[1]}/start?automation=1&headless=${headless}`,
        { method: "GET" },
      );
      send(res, 200, data);
      return;
    }

    // POST /profiles/:id/stop
    const stopMatch = pathname.match(/^\/profiles\/(\d+)\/stop$/);
    if (method === "POST" && stopMatch) {
      await ensureLoggedIn();
      const data = await dolphin(`/browser_profiles/${stopMatch[1]}/stop`, { method: "GET" });
      send(res, 200, data);
      return;
    }

    // POST /captcha/solve  { type, ...params }
    if (method === "POST" && pathname === "/captcha/solve") {
      const body = await readBody(req);
      if (!body.type) { send(res, 400, { error: "type is required" }); return; }
      const startedAt = Date.now();
      const result = await dispatchCaptcha(body);
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      send(res, 200, { ok: true, ...result, elapsed_s: parseFloat(elapsed) });
      return;
    }

    // GET /captcha/balance
    if (method === "GET" && pathname === "/captcha/balance") {
      const result = await dispatchCaptcha({ type: "balance" });
      send(res, 200, { ok: true, ...result });
      return;
    }

    send(res, 404, { error: "Not found", path: pathname });
  } catch (e) {
    console.error("[relay] Error:", e.message);
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║     AutoResolve Relay Agent — RUNNING        ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("  Port:    " + PORT);
  console.log("  Dolphin: " + DOLPHIN);
  console.log("  Token:   " + (TOKEN ? "✓ configured" : "✗ NOT SET"));
  console.log("  Proxy:   " + (PROXY_HOST ? PROXY_TYPE + "://" + PROXY_HOST + ":" + PROXY_PORT : "not configured"));
  console.log("  Auth:    " + (SECRET ? "secret required" : "open"));
  console.log("  Captcha: " + (CAPTCHA_KEY ? "✓ 2captcha ready" : "✗ TWOCAPTCHA_API_KEY not set"));
  console.log("");
  console.log("  Keep this window open while using AutoResolve.");
});
