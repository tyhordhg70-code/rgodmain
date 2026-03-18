/**
 * 2captcha solver — supports every type that 2captcha offers.
 *
 * Used by the AutoResolve automation flow when Dolphin hits a captcha.
 * The relay agent (on the RDP) calls POST /api/retail/captcha/solve on
 * this server, which calls the 2captcha API and returns the token.
 */

const BASE = "https://2captcha.com";
const POLL_INTERVAL_MS = 3_000;
const MAX_WAIT_MS = 120_000;

function apiKey(): string {
  const key = process.env.TWOCAPTCHA_API_KEY;
  if (!key) throw new Error("TWOCAPTCHA_API_KEY is not set");
  return key;
}

// ── Low-level helpers ─────────────────────────────────────────────────────────

async function submitTask(params: Record<string, string>): Promise<string> {
  const form = new URLSearchParams({ key: apiKey(), json: "1", ...params });
  const res = await fetch(`${BASE}/in.php`, {
    method: "POST",
    body: form,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const data: any = await res.json();
  if (data.status !== 1) throw new Error(`2captcha submit failed: ${data.request}`);
  return String(data.request);
}

async function pollResult(taskId: string): Promise<string> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const res = await fetch(
      `${BASE}/res.php?key=${apiKey()}&action=get&id=${taskId}&json=1`,
    );
    const data: any = await res.json();
    if (data.status === 1) return String(data.request);
    if (data.request !== "CAPCHA_NOT_READY")
      throw new Error(`2captcha poll failed: ${data.request}`);
  }
  throw new Error("2captcha timed out after 120s");
}

async function solve(params: Record<string, string>): Promise<string> {
  const taskId = await submitTask(params);
  console.log(`[captcha] task submitted: ${taskId}`);
  const token = await pollResult(taskId);
  console.log(`[captcha] solved: ${taskId}`);
  return token;
}

// ── Public solvers — one function per captcha type ────────────────────────────

/** Standard reCAPTCHA v2 (checkbox / invisible) */
export async function solveRecaptchaV2(opts: {
  sitekey: string;
  pageurl: string;
  invisible?: boolean;
  enterprise?: boolean;
  data_s?: string;
}): Promise<string> {
  return solve({
    method: "userrecaptcha",
    googlekey: opts.sitekey,
    pageurl: opts.pageurl,
    ...(opts.invisible ? { invisible: "1" } : {}),
    ...(opts.enterprise ? { enterprise: "1" } : {}),
    ...(opts.data_s ? { "data-s": opts.data_s } : {}),
  });
}

/** reCAPTCHA v3 (score-based, no UI) */
export async function solveRecaptchaV3(opts: {
  sitekey: string;
  pageurl: string;
  action?: string;
  min_score?: number;
  enterprise?: boolean;
}): Promise<string> {
  return solve({
    method: "userrecaptcha",
    version: "v3",
    googlekey: opts.sitekey,
    pageurl: opts.pageurl,
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.min_score != null ? { min_score: String(opts.min_score) } : {}),
    ...(opts.enterprise ? { enterprise: "1" } : {}),
  });
}

/** hCaptcha */
export async function solveHcaptcha(opts: {
  sitekey: string;
  pageurl: string;
  invisible?: boolean;
  enterprise_payload?: string;
}): Promise<string> {
  return solve({
    method: "hcaptcha",
    sitekey: opts.sitekey,
    pageurl: opts.pageurl,
    ...(opts.invisible ? { invisible: "1" } : {}),
    ...(opts.enterprise_payload ? { enterprise_payload: opts.enterprise_payload } : {}),
  });
}

/** Cloudflare Turnstile */
export async function solveTurnstile(opts: {
  sitekey: string;
  pageurl: string;
  action?: string;
  cdata?: string;
}): Promise<string> {
  return solve({
    method: "turnstile",
    sitekey: opts.sitekey,
    pageurl: opts.pageurl,
    ...(opts.action ? { action: opts.action } : {}),
    ...(opts.cdata ? { cdata: opts.cdata } : {}),
  });
}

/** Image captcha — pass a base64-encoded PNG/JPG or a publicly accessible URL */
export async function solveImageCaptcha(opts: {
  body?: string;
  url?: string;
  phrase?: boolean;
  case?: boolean;
  numeric?: 0 | 1 | 2;
  min_len?: number;
  max_len?: number;
  lang?: string;
  hint?: string;
}): Promise<string> {
  if (!opts.body && !opts.url)
    throw new Error("solveImageCaptcha requires body (base64) or url");
  return solve({
    method: "base64",
    ...(opts.body ? { body: opts.body } : {}),
    ...(opts.url ? { body: opts.url } : {}),
    ...(opts.phrase ? { phrase: "1" } : {}),
    ...(opts.case ? { regsense: "1" } : {}),
    ...(opts.numeric != null ? { numeric: String(opts.numeric) } : {}),
    ...(opts.min_len ? { min_len: String(opts.min_len) } : {}),
    ...(opts.max_len ? { max_len: String(opts.max_len) } : {}),
    ...(opts.lang ? { lang: opts.lang } : {}),
    ...(opts.hint ? { textinstructions: opts.hint } : {}),
  });
}

/** FunCaptcha / Arkose Labs */
export async function solveFuncaptcha(opts: {
  publickey: string;
  pageurl: string;
  surl?: string;
  userAgent?: string;
  data?: string;
}): Promise<string> {
  return solve({
    method: "funcaptcha",
    publickey: opts.publickey,
    pageurl: opts.pageurl,
    ...(opts.surl ? { surl: opts.surl } : {}),
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
    ...(opts.data ? { data: opts.data } : {}),
  });
}

/** GeeTest v3 */
export async function solveGeetest(opts: {
  gt: string;
  challenge: string;
  pageurl: string;
  api_server?: string;
}): Promise<{ challenge: string; validate: string; seccode: string }> {
  const raw = await solve({
    method: "geetest",
    gt: opts.gt,
    challenge: opts.challenge,
    pageurl: opts.pageurl,
    ...(opts.api_server ? { api_server: opts.api_server } : {}),
  });
  const parts = Object.fromEntries(raw.split(";").map((p) => p.split("=")));
  return {
    challenge: parts["challenge"] ?? "",
    validate: parts["validate"] ?? "",
    seccode: parts["seccode"] ?? "",
  };
}

/** GeeTest v4 */
export async function solveGeetestV4(opts: {
  captcha_id: string;
  pageurl: string;
}): Promise<{ captcha_id: string; lot_number: string; pass_token: string; gen_time: string; captcha_output: string }> {
  const raw = await solve({
    method: "geetest_v4",
    captcha_id: opts.captcha_id,
    pageurl: opts.pageurl,
  });
  return JSON.parse(raw);
}

/** KeyCaptcha */
export async function solveKeycaptcha(opts: {
  s_s_c_user_id: string;
  s_s_c_session_id: string;
  s_s_c_web_server_sign: string;
  s_s_c_web_server_sign2: string;
  pageurl: string;
}): Promise<string> {
  return solve({
    method: "keycaptcha",
    s_s_c_user_id: opts.s_s_c_user_id,
    s_s_c_session_id: opts.s_s_c_session_id,
    s_s_c_web_server_sign: opts.s_s_c_web_server_sign,
    s_s_c_web_server_sign2: opts.s_s_c_web_server_sign2,
    pageurl: opts.pageurl,
  });
}

/** Lemin Cropped Captcha */
export async function solveLemin(opts: {
  captcha_id: string;
  div_id: string;
  pageurl: string;
  api_server?: string;
}): Promise<{ answer: string; challenge_id: string }> {
  const raw = await solve({
    method: "lemin",
    captcha_id: opts.captcha_id,
    div_id: opts.div_id,
    pageurl: opts.pageurl,
    ...(opts.api_server ? { api_server: opts.api_server } : {}),
  });
  return JSON.parse(raw);
}

/** Amazon WAF captcha (AWS) */
export async function solveAmazonWaf(opts: {
  sitekey: string;
  iv: string;
  context: string;
  pageurl: string;
  challenge_script?: string;
  captcha_script?: string;
}): Promise<string> {
  return solve({
    method: "amazon_waf",
    sitekey: opts.sitekey,
    iv: opts.iv,
    context: opts.context,
    pageurl: opts.pageurl,
    ...(opts.challenge_script ? { challenge_script: opts.challenge_script } : {}),
    ...(opts.captcha_script ? { captcha_script: opts.captcha_script } : {}),
  });
}

/** Capy Puzzle CAPTCHA */
export async function solveCapy(opts: {
  captchakey: string;
  pageurl: string;
  api_server?: string;
}): Promise<string> {
  return solve({
    method: "capy",
    captchakey: opts.captchakey,
    pageurl: opts.pageurl,
    ...(opts.api_server ? { api_server: opts.api_server } : {}),
  });
}

/** DataDome (cookie challenge — requires proxy) */
export async function solveDatadome(opts: {
  captcha_url: string;
  pageurl: string;
  userAgent: string;
  proxy: string;
  proxytype?: string;
}): Promise<string> {
  return solve({
    method: "datadome",
    captcha_url: opts.captcha_url,
    pageurl: opts.pageurl,
    userAgent: opts.userAgent,
    proxy: opts.proxy,
    proxytype: opts.proxytype ?? "HTTPS",
  });
}

/** Plain text captcha */
export async function solveTextCaptcha(opts: {
  textcaptcha: string;
  lang?: string;
}): Promise<string> {
  return solve({
    method: "post",
    textcaptcha: opts.textcaptcha,
    ...(opts.lang ? { lang: opts.lang } : {}),
  });
}

/**
 * Temu captcha (temu.com — Arkose Labs / custom slide puzzle)
 *
 * How to get the params from the Temu page:
 *  - Intercept the XHR to `/api/bg/tsp-csr/captcha` — it contains `app_id` and `nonce`
 *  - Or read them from `window.__TEMU_CAPTCHA_CONFIG__` in the page console
 *
 * The solved token is injected back via:
 *   window.__TEMU_CAPTCHA_RESOLVE__(token)
 */
export async function solveTemu(opts: {
  app_id: string;
  nonce: string;
  pageurl: string;
  userAgent?: string;
}): Promise<string> {
  return solve({
    method: "temu",
    app_id: opts.app_id,
    nonce: opts.nonce,
    pageurl: opts.pageurl,
    ...(opts.userAgent ? { userAgent: opts.userAgent } : {}),
  });
}

/** Check account balance */
export async function getBalance(): Promise<number> {
  const res = await fetch(
    `${BASE}/res.php?key=${apiKey()}&action=getbalance&json=1`,
  );
  const data: any = await res.json();
  if (data.status !== 1) throw new Error(`Balance check failed: ${data.request}`);
  return parseFloat(data.request);
}

// ── Generic dispatcher (used by the HTTP endpoint) ────────────────────────────

export type CaptchaRequest =
  | ({ type: "recaptchav2" } & Parameters<typeof solveRecaptchaV2>[0])
  | ({ type: "recaptchav3" } & Parameters<typeof solveRecaptchaV3>[0])
  | ({ type: "hcaptcha" } & Parameters<typeof solveHcaptcha>[0])
  | ({ type: "turnstile" } & Parameters<typeof solveTurnstile>[0])
  | ({ type: "image" } & Parameters<typeof solveImageCaptcha>[0])
  | ({ type: "funcaptcha" } & Parameters<typeof solveFuncaptcha>[0])
  | ({ type: "geetest" } & Parameters<typeof solveGeetest>[0])
  | ({ type: "geetestv4" } & Parameters<typeof solveGeetestV4>[0])
  | ({ type: "keycaptcha" } & Parameters<typeof solveKeycaptcha>[0])
  | ({ type: "lemin" } & Parameters<typeof solveLemin>[0])
  | ({ type: "amazon_waf" } & Parameters<typeof solveAmazonWaf>[0])
  | ({ type: "capy" } & Parameters<typeof solveCapy>[0])
  | ({ type: "datadome" } & Parameters<typeof solveDatadome>[0])
  | ({ type: "text" } & Parameters<typeof solveTextCaptcha>[0])
  | ({ type: "temu" } & Parameters<typeof solveTemu>[0])
  | { type: "balance" };

export async function dispatch(req: CaptchaRequest): Promise<unknown> {
  switch (req.type) {
    case "recaptchav2":  return solveRecaptchaV2(req);
    case "recaptchav3":  return solveRecaptchaV3(req);
    case "hcaptcha":     return solveHcaptcha(req);
    case "turnstile":    return solveTurnstile(req);
    case "image":        return solveImageCaptcha(req);
    case "funcaptcha":   return solveFuncaptcha(req);
    case "geetest":      return solveGeetest(req);
    case "geetestv4":    return solveGeetestV4(req);
    case "keycaptcha":   return solveKeycaptcha(req);
    case "lemin":        return solveLemin(req);
    case "amazon_waf":   return solveAmazonWaf(req);
    case "capy":         return solveCapy(req);
    case "datadome":     return solveDatadome(req);
    case "text":         return solveTextCaptcha(req);
    case "temu":         return solveTemu(req);
    case "balance":      return { balance: await getBalance() };
    default:
      throw new Error(`Unknown captcha type: ${(req as any).type}`);
  }
}
