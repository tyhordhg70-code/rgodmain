/**
 * Dolphin Anty browser automation client.
 *
 * Two modes:
 *  1. RELAY mode (recommended):  set RELAY_URL=http://64.188.112.247:4001
 *     The relay-agent.js runs on the RDP machine and calls Dolphin locally.
 *     This bypasses Dolphin's localhost-only restriction.
 *
 *  2. DIRECT mode (fallback):    RELAY_URL is not set.
 *     Calls Dolphin's local API at DOLPHIN_API_URL directly.
 *     Requires port-forwarding on the RDP and local-API auth to work.
 *
 * Other env vars:
 *   RELAY_SECRET      — shared secret for relay auth (optional)
 *   DOLPHIN_API_URL   — direct Dolphin base URL (default: http://64.188.112.247:3001)
 *   DOLPHIN_API_TOKEN — JWT from dolphin-anty.com (used by relay)
 *   PROXY_TYPE / PROXY_HOST / PROXY_PORT / PROXY_USER / PROXY_PASS
 */

const RELAY_URL   = (process.env.RELAY_URL ?? "").replace(/\/$/, "");
const RELAY_SECRET = process.env.RELAY_SECRET ?? "";

const DOLPHIN_BASE = (
  process.env.DOLPHIN_API_URL ?? "http://64.188.112.247:3001"
).replace(/\/$/, "");
const DOLPHIN_TOKEN = process.env.DOLPHIN_API_TOKEN ?? "";

// ─── Low-level fetch helpers ──────────────────────────────────────────────────

async function relayFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    };
    if (RELAY_SECRET) headers["x-relay-secret"] = RELAY_SECRET;

    const res = await fetch(`${RELAY_URL}${path}`, { ...options, headers, signal: controller.signal });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!res.ok) throw new Error(`Relay ${res.status}: ${json?.error ?? text}`);
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

async function dolphinFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 8_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    };
    if (DOLPHIN_TOKEN) headers["Authorization"] = `Bearer ${DOLPHIN_TOKEN}`;

    const res = await fetch(`${DOLPHIN_BASE}/v1.0${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Dolphin API ${res.status}: ${body || res.statusText}`);
    }
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timer);
  }
}

// Use relay if configured, otherwise fall back to direct Dolphin API
function useRelay() { return RELAY_URL.length > 0; }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DolphinProfile {
  id: number;
  name: string;
  status?: string;
  browserType?: string;
  tags?: string[];
  proxy?: { type: string; host: string; port: number; login?: string } | null;
  platform?: string;
  screen?: string;
  notes?: string;
}

export interface DolphinStartResult {
  /** Chromium remote-debugging port on the RDP machine */
  port: number;
  /** Full ws:// endpoint for CDP — usable by automation scripts on the RDP */
  wsEndpoint: string;
}

export interface DolphinProfilesPage {
  data: DolphinProfile[];
  meta: { total: number; page: number };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true if Dolphin (via relay or directly) is reachable. */
export async function pingDolphin(): Promise<boolean> {
  try {
    if (useRelay()) {
      await relayFetch("/dolphin-ping", {}, 6_000);
    } else {
      await dolphinFetch("/browser_profiles?page=0&per_page=1", {}, 5_000);
    }
    return true;
  } catch {
    return false;
  }
}

/** List browser profiles. */
export async function listProfiles(page = 0, perPage = 50): Promise<DolphinProfilesPage> {
  if (useRelay()) {
    const raw = await relayFetch<any>("/profiles");
    // relay returns the dolphin response directly
    return raw as DolphinProfilesPage;
  }
  return dolphinFetch<DolphinProfilesPage>(`/browser_profiles?page=${page}&per_page=${perPage}`);
}

/** Get a single profile by ID. */
export async function getProfile(id: number): Promise<DolphinProfile> {
  if (useRelay()) {
    const page = await listProfiles(0, 200);
    const found = page.data?.find((p) => p.id === id);
    if (!found) throw new Error(`Profile ${id} not found`);
    return found;
  }
  return dolphinFetch<DolphinProfile>(`/browser_profiles/${id}`);
}

/**
 * Create a new browser profile for a merchant.
 * Returns the new profile's numeric ID.
 */
export async function createProfile(merchantName: string): Promise<number> {
  let raw: any;
  if (useRelay()) {
    raw = await relayFetch<any>("/profiles", {
      method: "POST",
      body: JSON.stringify({ name: merchantName }),
    }, 20_000);
  } else {
    raw = await dolphinFetch<any>("/browser_profiles", {
      method: "POST",
      body: JSON.stringify({
        name: merchantName,
        browserType: "anty",
        os: "windows",
        useragent: { mode: "auto" },
        webrtc: { mode: "altered" },
        canvas: { mode: "real" },
        webgl: { mode: "noise" },
        timezone: { mode: "auto" },
        locale: { mode: "auto" },
        tags: ["autoresolve"],
      }),
    }, 15_000);
  }

  const id: number =
    raw?.browserProfileId ??
    raw?.data?.id ??
    raw?.id;

  if (!id) throw new Error(`createProfile: no ID in response — ${JSON.stringify(raw)}`);
  return id;
}

/**
 * Start a browser profile.
 * Returns the CDP WebSocket endpoint to connect Playwright/Puppeteer.
 * The wsEndpoint is valid on the RDP machine's localhost only.
 */
export async function startProfile(profileId: number, headless = false): Promise<DolphinStartResult> {
  let raw: any;
  if (useRelay()) {
    raw = await relayFetch<any>(`/profiles/${profileId}/start`, {
      method: "POST",
      body: JSON.stringify({ headless }),
    }, 35_000);
  } else {
    raw = await dolphinFetch<any>(
      `/browser_profiles/${profileId}/start?automation=1&headless=${headless ? 1 : 0}`,
      { method: "GET" },
      30_000,
    );
  }

  // Dolphin Anty response: { automation: { port: 53123, wsEndpoint: "ws://127.0.0.1:53123/..." } }
  const port: number = raw?.automation?.port ?? raw?.port;
  if (!port) throw new Error(`Dolphin start: no port returned — ${JSON.stringify(raw)}`);

  const wsEndpoint: string =
    raw?.automation?.wsEndpoint ??
    raw?.wsEndpoint ??
    `ws://127.0.0.1:${port}`;

  return { port, wsEndpoint };
}

/** Stop a running browser profile. */
export async function stopProfile(profileId: number): Promise<void> {
  if (useRelay()) {
    await relayFetch(`/profiles/${profileId}/stop`, { method: "POST" });
  } else {
    await dolphinFetch(`/browser_profiles/${profileId}/stop`, { method: "GET" });
  }
}

/**
 * Push residential proxy settings into a Dolphin profile.
 * In relay mode, the relay reads proxy vars from its own env.
 * In direct mode, reads PROXY_* from this server's env.
 */
export async function applyProxyToProfile(profileId: number): Promise<void> {
  if (useRelay()) {
    // Relay handles proxy config from its own env vars
    await relayFetch(`/profiles/${profileId}/proxy`, { method: "POST" });
    return;
  }

  const host = process.env.PROXY_HOST;
  const port = process.env.PROXY_PORT;
  const login = process.env.PROXY_USER;
  const password = process.env.PROXY_PASS;
  const type = process.env.PROXY_TYPE ?? "socks5";

  if (!host || !port) return;

  await dolphinFetch(`/browser_profiles/${profileId}`, {
    method: "PATCH",
    body: JSON.stringify({
      proxy: {
        type, host, port: Number(port),
        ...(login ? { login, password: password ?? "" } : {}),
      },
    }),
  });
}

/** Returns the configured mode and base URL (for display/logging). */
export function getDolphinBaseUrl(): string {
  return useRelay() ? `${RELAY_URL} (relay → ${DOLPHIN_BASE})` : DOLPHIN_BASE;
}
