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
  commands: {
    search: {
      description: "Search for products",
      params: {
        q: { type: "string", description: "Search query", required: true },
        limit: { type: "number", description: "Max results", default: 10 },
      },
      returns: "Array of matching products",
      handler: async ({ q, limit }) => {
        return await db.products.search(q, { limit });
      },
    },
    getProduct: {
      description: "Get a product by ID",
      params: {
        id: { type: "string", required: true },
      },
      handler: async ({ id }) => {
        return await db.products.findById(id);
      },
    },
    addToCart: {
      description: "Add a product to the cart",
      params: {
        productId: { type: "string", required: true },
        quantity: { type: "number", required: true },
      },
      handler: async ({ productId, quantity }, ctx) => {
        return await cart.add(ctx.userId, productId, quantity);
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

const client = createClient();
const site = await client.connect("https://acme.com");

console.log(site.commands());
// → ["search", "getProduct", "addToCart"]

const results = await site.run("search", { q: "running shoes", limit: 5 });
// → [{ id: "...", name: "Nike Air Zoom", price: 120 }, ...]

const product = await site.run("getProduct", { id: "nike-air-zoom-001" });
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
    "message": "Unknown command: \"foo\". Available: search, getProduct, addToCart"
  }
}
```

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

```ts
// API Key
createMorlock({
  auth: { type: "apikey", keyHeader: "X-API-Key" },
  // ...
});

// Bearer token
createMorlock({
  auth: { type: "bearer" },
  // ...
});
```

Agent-side:

```ts
const client = createClient({ apiKey: "sk-..." });
// or
const client = createClient({ bearerToken: "..." });
```

---

## Rate Limiting

```ts
createMorlock({
  rateLimit: { requests: 60, windowMs: 60_000 }, // 60 req/min per IP
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
    const results = await site.run("search", { q: "shoes" });
    console.log(`${site.manifest.name}:`, results);
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
