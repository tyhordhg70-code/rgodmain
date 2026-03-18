# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains the **Secure-Response-Hub** full-stack application: an encrypted order-submission form, admin dashboard with client-side decryption, Telegram bot integration, and AutoResolve retail command center.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Frontend**: React + Vite + Tailwind CSS v4
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod v3 (catalog), `drizzle-zod` (runtime schemas)
- **DB types**: drizzle-orm `$inferSelect` / `$inferInsert` (NOT `z.infer` — avoids drizzle-zod v4 type conflict)
- **Build**: esbuild (API CJS bundle), Vite (frontend)

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/               # Express API + Telegram bot (port via PORT env)
│   └── secure-response-hub/      # React/Vite frontend (port via PORT env)
├── lib/
│   ├── api-spec/                 # OpenAPI spec + Orval codegen config
│   ├── api-client-react/         # Generated React Query hooks
│   ├── api-zod/                  # Generated Zod schemas from OpenAPI
│   └── db/                       # Drizzle ORM schema + DB connection
├── scripts/                      # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` with `composite: true`. Always build `lib/db` first before typechecking `api-server`:

```bash
pnpm --filter @workspace/db exec tsc --project tsconfig.json   # build declarations
pnpm --filter @workspace/api-server run typecheck               # then typecheck
```

**Important**: `drizzle-zod@0.8.x` generates Zod v4 types but the catalog uses Zod v3. The schema file in `lib/db/src/schema/index.ts` therefore uses `typeof table.$inferSelect` / `Omit<typeof table.$inferInsert, ...>` directly instead of `z.infer<typeof createInsertSchema(...)>`. The zod schemas are kept for **runtime validation only** (`.parse()`/`.safeParse()`).

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server with full Secure-Response-Hub functionality.

- **Entry**: `src/index.ts` — reads PORT, starts HTTP server, calls `registerRoutes()`
- **App setup**: `src/app.ts` — CORS, Helmet, cookie-parser, rate-limit
- **Routes**: `src/routes/responses.ts` (form + auth + responses API), `src/routes/retail.ts` (AutoResolve retail orders/merchants/sessions), `src/routes/index.ts` (health only)
- **Telegram**: `src/telegram-bot.ts` — webhook in production, polling in dev
- **Storage**: `src/storage.ts` — all DB access via Drizzle
- **Auth**: bcrypt-hashed `DASHBOARD_PASSWORD` at startup; session-based auth
- **Encryption**: `ENCRYPTION_KEY` returned on login; form data encrypted client-side
- Dev: `pnpm --filter @workspace/api-server run dev`
- Build: `pnpm --filter @workspace/api-server run build` → `dist/index.cjs` (esbuild)

Key API routes:
- `GET /api/form/config` — form questions (public)
- `GET /api/form/settings` — end-page text (public)
- `POST /api/v1/submit` — encrypted form submission (public, rate-limited)
- `POST /api/auth/login` — returns `{ encryptionKey }` on success
- `GET /api/data/responses` — encrypted responses list (auth required)
- `GET /api/retail/orders` — retail orders (auth required)
- All `/api/retail/*` — AutoResolve module (auth required)

### `artifacts/secure-response-hub` (`@workspace/secure-response-hub`)

React + Vite + Tailwind CSS v4 frontend.

- **Routing**: React Router — `/` home, `/form` submission form, `/login`, `/dashboard`, `/form-editor`, `/autoresolve`
- **Theme**: `:root` = light mode, `.dark` class = dark mode; toggled via `localStorage["dash-theme"]`; applied in `main.tsx` IIFE before first render
- **Encryption**: AES-GCM via Web Crypto API; key from `sessionStorage["dk"]` (set at login)
- **Form**: Multi-page step form, questions loaded from `/api/form/config`
- **Dashboard**: Encrypted responses with client-side decrypt, notes, Telegram, form editor
- **AutoResolve**: Retail order management (merchants, sessions, automation)
- Dev: `pnpm --filter @workspace/secure-response-hub run dev`
- Build: `pnpm --filter @workspace/secure-response-hub run build`

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

- `src/index.ts` — creates `Pool` + Drizzle instance, `export * from "./schema"`
- `src/schema/index.ts` — all table definitions + insert schemas + type exports
- Run `pnpm --filter @workspace/db run push` to push schema changes to DB

Tables: `users`, `responses`, `response_notes`, `retail_merchants`, `retail_orders`, `retail_sessions`, `retail_activity`, `form_questions`, `form_settings`

### Other libs

- `lib/api-spec` — OpenAPI spec + Orval codegen config
- `lib/api-client-react` — generated React Query hooks
- `lib/api-zod` — generated Zod schemas from OpenAPI
- `scripts` — utility scripts

## Environment Secrets

| Secret | Purpose |
|--------|---------|
| `DASHBOARD_PASSWORD` | Admin dashboard login (bcrypt-hashed at startup) |
| `ENCRYPTION_KEY` | AES-GCM key for encrypting form submissions |
| `SESSION_SECRET` | Express session signing |
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token |
| `TELEGRAM_CHAT_ID` | Default Telegram chat for notifications |

## Workflows

- `artifacts/api-server: API Server` — runs `tsx ./src/index.ts` on `$PORT`
- `artifacts/secure-response-hub: web` — runs `vite --config vite.config.ts` on `$PORT`

## Form Questions

18 questions across 5 pages:
- `agreement` — radio (Yes/No), page 1; amber-box description shows full legal disclaimer
- `platform` — type `url` (URLField with URL_REGEX + Link icon; accepts amazon.com, eBay, etc.)
- `order_value` — type `text`; **CURRENCY_REGEX validated** (accepts $250.00, £99.99, €150, 250 USD); DollarSign icon label
- `phone` — type `phone` (PhoneField with country flag picker + dial code; stores as "+1 555 0123")
- `contact_method` — type `select` (Email, Phone, WhatsApp, Telegram)
- `telegram_username` — type `text`, page 5, optional; **shown only when contact_method = "Telegram"**; `@` required + format validated; AtSign icon label; required asterisk shown dynamically
- `condition` — type `select`
- `contacted_seller` — type `radio`
- `order_date` — type `date`
Update questions via Form Editor in dashboard or `PUT /api/data/questions` (auth required).

## Import Format

- Accepts `.csv` and `.json` (case-insensitive extension check)
- Column names auto-mapped: `order_number`→`order_ref`, `merchant_name`→`platform`, `telegram`→`telegram_username`, etc.
- JSON files: auto-flattened (nested objects merged with dot-prefix, arrays joined as strings)
- Two template downloads: **CSV Template** and **JSON Template** (both available in Import dialog)
- JSON format (flat array): `[{ "order_ref": "ORD-123", "full_name": "John Doe", ... }]`

## Deploy

- **Production**: Plesk at `45.153.34.48`; domain `refundgod.fans`
- **Deploy script**: `bash deploy/plesk/deploy.sh`
- **RDP automation**: Scripts at `deploy/rdp-scripts/`; run via `deploy/start-watcher.bat`
- **Relay agent**: `deploy/relay-agent.cjs` — captcha relay between RDP and 2captcha API
- No Docker — Docker files removed. Using Plesk + Node.js natively.
