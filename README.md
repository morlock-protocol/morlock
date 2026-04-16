# 🕳️ Morlock

**Make your site agent-native in 10 minutes.**

Morlock is an open protocol and drop-in library that gives AI agents a structured, typed interface to your website — instead of screenshotting it, parsing DOM, or brute-forcing your REST API.

Think `robots.txt` told crawlers where *not* to go. Morlock tells agents what they *can do*.

---

## The Problem

AI agents browsing the web today do one of three things — all bad:

- **Vision models** — screenshot the page, "see" it. Expensive and slow.
- **DOM scraping** — strip HTML, hope semantic structure survives. Fragile.
- **Browser automation** — simulate a human with Playwright. Resource-heavy and breaks constantly.

The web was never designed for agents. Morlock fixes that.

---

## How It Works

### 1. Site owner drops in the library

```ts
// npm install @morlock/core
import { createMorlock } from "@morlock/core/server";

const morlock = createMorlock({
  name: "Acme Store",
  baseUrl: "https://acme.com",
  auth: { type: "bearer", allowPublicRead: true },
  verifier: async ({ token }) => {
    const user = await sessions.verify(token);
    return user ? { ok: true, principal: user.id } : { ok: false, reason: "Invalid token" };
  },
  commands: {
    search: {
      description: "Search for products",
      safety: "read",           // no side effects → no auth needed (allowPublicRead)
      params: {
        q: { type: "string", description: "Search query", required: true },
        limit: { type: "number", description: "Max results", default: 10 },
      },
      returns: "Array of matching products",
      handler: async ({ q, limit }) => db.products.search(q, { limit }),
    },
    getProduct: {
      description: "Get a product by ID",
      safety: "read",
      params: { id: { type: "string", required: true } },
      handler: async ({ id }) => db.products.findById(id),
    },
    addToCart: {
      description: "Add a product to the cart",
      safety: "unsafe",         // has side effects → auth + idempotency key required
      requiredScopes: ["cart:write"],
      params: {
        productId: { type: "string", required: true },
        quantity: { type: "number", required: true },
      },
      handler: async ({ productId, quantity }, ctx) => {
        return cart.add(ctx.principal!, productId, quantity);
      },
    },
  },
});

// Express
app.use(morlock.express());

// Next.js (app/api/agent/route.ts)
export const { GET, POST } = morlock.nextjs();

// Cloudflare Workers / Bun / Deno
export default { fetch: morlock.fetch() };
```

### 2. Agent discovers and uses it

```ts
import { createClient } from "@morlock/core/client";

const client = createClient({ bearerToken: "sk-..." });
const site = await client.connect("https://acme.com");

console.log(site.commands());
// → ["search", "getProduct", "addToCart"]

const { result: products } = await site.run("search", { q: "running shoes", limit: 5 });
// → [{ id: "...", name: "Nike Air Zoom", price: 120 }, ...]

const { result: product } = await site.run("getProduct", { id: "nike-air-zoom-001" });

// Write commands: the client generates an idempotency key automatically
// and reuses it on retry so the cart doesn't get added to twice.
const { result, replayed } = await site.run("addToCart", {
  productId: "nike-air-zoom-001",
  quantity: 1,
});
```

---

## The Protocol

### Discovery

Agents check for Morlock via:

```
GET /.well-known/morlock
```

Response:

```json
{
  "morlock": "0.2",
  "name": "Acme Store",
  "baseUrl": "https://acme.com",
  "endpoint": "https://acme.com/.well-known/morlock",
  "auth": { "type": "none" },
  "commands": {
    "search": {
      "description": "Search for products",
      "params": {
        "q": { "type": "string", "required": true },
        "limit": { "type": "number", "default": 10 }
      },
      "returns": "Array of matching products"
    }
  }
}
```

### Command Execution

```
POST /.well-known/morlock
Content-Type: application/json

{
  "command": "search",
  "args": { "q": "running shoes", "limit": 5 },
  "requestId": "req_abc123"
}
```

```json
{
  "ok": true,
  "requestId": "req_abc123",
  "result": [...],
  "meta": { "executionMs": 42 }
}
```

### Error Response

```json
{
  "ok": false,
  "requestId": "req_abc123",
  "error": {
    "code": "UNKNOWN_COMMAND",
    "message": "Command not found."
  }
}
```

Error messages never leak valid command names. Agents discover capabilities through the manifest, not by probing the endpoint. See [spec v0.2 §12](spec/v0.2.md) for the full security model.

Full error-code table:

| Code | HTTP | Meaning |
|---|---|---|
| `UNKNOWN_COMMAND` | 404 | Command not found. Message is generic. |
| `INVALID_PARAMS` | 422 | Missing required param, wrong type, or invalid body. |
| `AUTH_REQUIRED` | 401 | Credentials missing. |
| `FORBIDDEN` | 403 | Credentials valid but scopes/permissions insufficient. |
| `IDEMPOTENCY_KEY_REQUIRED` | 409 | Write/unsafe command sent without `X-Morlock-Idempotency-Key`. |
| `RATE_LIMITED` | 429 | Per-IP window exceeded. |
| `COMMAND_FAILED` | 500 | Handler threw. Message is the error's `message` (no stack). |

---

## Framework Support

| Framework | Status |
|---|---|
| Express / Connect | ✅ |
| Next.js App Router | ✅ |
| Cloudflare Workers | ✅ |
| Bun | ✅ |
| Deno | ✅ |
| Fastify | 🔜 |
| Hono | 🔜 |

---

## Auth

Declared auth is **enforced at runtime**. Declaring `auth.type` without a `verifier` is a startup error — the library refuses to boot rather than silently serve unauthenticated traffic.

```ts
createMorlock({
  auth: {
    type: "bearer",
    allowPublicRead: true,   // read commands bypass auth; writes still require it
  },
  verifier: async ({ type, token, scopes, command }) => {
    const session = await sessions.verify(token);
    if (!session) return { ok: false, reason: "Invalid or expired token" };

    // Optional: enforce per-command OAuth2 scopes
    if (scopes && !scopes.every((s) => session.scopes.includes(s))) {
      return { ok: false, reason: `Missing scope: ${scopes.join(", ")}` };
    }

    return { ok: true, principal: session.userId };
  },
  commands: { /* ... */ },
});
```

**Auth types:**

```ts
// API key — agent sends X-Api-Key or a custom header
auth: { type: "apikey", keyHeader: "X-API-Key" }

// Bearer — agent sends Authorization: Bearer <token>
auth: { type: "bearer" }

// OAuth 2.0 — agent obtains a token via client-credentials flow
auth: { type: "oauth2", tokenUrl: "https://acme.com/oauth/token", scopes: ["read", "write"] }
```

Agent-side:

```ts
const client = createClient({ apiKey: "sk-..." });       // for apikey auth
const client = createClient({ bearerToken: "eyJhbG..." }); // for bearer/oauth2
```

**Safety and auth interact:**

| `safety` | Default auth behaviour |
|---|---|
| `"read"` | Bypassed **only if** `auth.allowPublicRead: true`. Otherwise required. |
| `"write"` | Auth required. |
| `"unsafe"` | Auth required. Idempotency key required. |

Commands with no `safety` annotation default to `"unsafe"` — the safe default.

---

## Rate Limiting

```ts
createMorlock({
  rateLimit: {
    maxRequests: 60,
    windowMs: 60_000,
    trustedProxyCount: 1,     // ← set this if you run behind a proxy
  },
  // ...
});
```

**`trustedProxyCount` is critical.** Morlock will not trust `X-Forwarded-For` unless you tell it how many proxies are in front:

| Deployment | `trustedProxyCount` |
|---|---|
| Direct (no proxy) | `0` (default) |
| Vercel, Cloudflare, Fly.io, Railway | `1` |
| Load balancer → Vercel | `2` |
| Unknown / misconfigured | Leave at `0` — all clients share one bucket, but nobody can spoof. |

Setting this too high lets attackers spoof their IP via a crafted `X-Forwarded-For` header and bypass rate limits. Too low over-aggregates. If in doubt, leave it at `0` and rely on your proxy's own rate limiting.

For multi-process / multi-region deployments, the in-memory store is per-process. Plug in a Redis- or KV-backed store:

```ts
rateLimit: {
  maxRequests: 60,
  windowMs: 60_000,
  trustedProxyCount: 1,
  store: myRedisLimiterStore,   // implements RateLimiterStore
}
```

---

## CORS

Cross-origin access is **denied by default**. Set `corsOrigins` explicitly:

```ts
// Trusted allowlist (preferred)
corsOrigins: ["https://your-agent-host.com"]

// Fully public, read-only, unauthenticated manifest only
corsOrigins: "*"
```

Per spec v0.2 §3.3, sites exposing write or authenticated commands **MUST NOT** use `"*"`.

---

## Idempotency

Write and unsafe commands require an `X-Morlock-Idempotency-Key` header. The client SDK generates and reuses keys automatically — you only think about this when writing a custom HTTP client.

- Duplicate requests within the dedup window (default 24h) return the cached response with `meta.idempotentReplayed: true`. The handler is **not** re-run — even if it previously failed after a partial side-effect.
- The default store is in-memory. For HA, plug in Redis/KV via the `store` option on `idempotency`.

```ts
createMorlock({
  idempotency: {
    dedupeWindowMs: 24 * 60 * 60 * 1000,  // 24 hours (default)
    store: myRedisIdempotencyStore,
  },
  // ...
});
```

---

## Multi-site (Agents)

```ts
const client = createClient();

// Probe a list of sites — skips non-Morlock sites silently
const sites = await client.connectMany([
  "https://acme.com",
  "https://shopify.com",
  "https://notamorlock-site.com", // silently skipped
]);

// Now orchestrate across all of them
for (const site of sites) {
  if (site.has("search")) {
    const { result } = await site.run("search", { q: "shoes" });
    console.log(`${site.manifest.name}:`, result);
  }
}
```

---

## Why Not MCP?

MCP (Model Context Protocol) is great — and Morlock is complementary to it, not competing.

| | MCP | Morlock |
|---|---|---|
| Scope | Local tools, file systems, APIs | Web-native site capabilities |
| Setup | Server process + SDK | Drop a script tag / middleware |
| Discovery | Manual config | Automatic (`.well-known`) |
| Auth users | Developers | Any site owner |
| Analogy | USB-C | HTTP |

Think of Morlock as the HTTP layer that MCP servers can sit on top of.

---

## Roadmap

- [ ] `@morlock/registry` — a public index of Morlock-enabled sites
- [ ] `@morlock/analytics` — dashboard for site owners (what are agents doing?)
- [ ] `@morlock/verify` — agent identity & credential layer
- [ ] Browser extension for detecting Morlock-enabled sites
- [ ] WordPress / Shopify plugins (zero-config)
- [ ] LLM system prompt generator from manifest

---

## Contributing

Morlock is MIT licensed and built in the open. The protocol spec lives in `/spec/v0.2.md`. PRs welcome.

---

## Philosophy

Standards that win are open by default. `robots.txt` is a text file anyone can write. `sitemap.xml` has no gatekeepers. Morlock follows that tradition — the protocol is a spec anyone can implement, the library is a convenience, and the hosted services are optional.

We're building the infrastructure layer for the agentic web. Come help.

---

*Made with 🖤 by [Minds & Machines](https://mnm.dev) and contributors.*
