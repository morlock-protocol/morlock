// ─────────────────────────────────────────────────────────────────────────────
// Morlock — Usage Examples
//
// These examples are illustrative only. They are not part of the published
// package and are not built. Copy-adapt into your own project.
// ─────────────────────────────────────────────────────────────────────────────

// ── EXAMPLE 1: Express, public read-only ─────────────────────────────────────

import express from "express";
import { createMorlock } from "@morlock/core/server";

const app = express();
app.use(express.json({ limit: "256kb" }));

const morlock = createMorlock({
  name: "My Blog",
  baseUrl: "https://myblog.com",
  corsOrigins: "*",                     // public, read-only manifest — safe to widen
  commands: {
    getPosts: {
      description: "List recent blog posts",
      safety: "read",                   // read commands: no auth, no idempotency key
      params: {
        limit: { type: "number", default: 10 },
        tag:   { type: "string", description: "Filter by tag" },
      },
      returns: "Array of post objects",
      examples: [
        {
          params: { limit: 3, tag: "ai" },
          result: [{ slug: "future-of-ai", title: "The Future of AI", date: "2025-01-01" }],
        },
      ],
      handler: async ({ limit, tag }) => {
        // your actual data fetching logic
        return [{ slug: "example", title: "Example Post", date: "2025-01-01", limit, tag }];
      },
    },

    getPost: {
      description: "Get a specific blog post by slug",
      safety: "read",
      params: {
        slug: { type: "string", required: true },
      },
      handler: async ({ slug }) => ({ slug, title: "Example", content: "..." }),
    },
  },

  rateLimit: {
    maxRequests: 30,
    windowMs: 60_000,
    trustedProxyCount: 0,               // direct connection; set to 1 behind Cloudflare/Vercel/etc.
  },

  onRequest: (req, ctx) => {
    // Log principal (if authed) and resolved IP. ctx.ip is only populated on Express.
    console.log(`[morlock] ${req.command} from ${ctx.clientIp} principal=${ctx.principal ?? "-"}`);
  },
  onError: (err, req) => {
    console.error(`[morlock] ${req.command} failed:`, err);
  },
});

app.use(morlock.express());
app.listen(3000);


// ── EXAMPLE 2: Next.js App Router with auth + writes ─────────────────────────

// File: app/api/morlock/route.ts
//   (or app/.well-known/morlock/route.ts — wherever you mount it)

import { createMorlock as createMorlockNext } from "@morlock/core/server";

const morlockNext = createMorlockNext({
  name: "My Next.js App",
  baseUrl: process.env.NEXT_PUBLIC_URL!,
  corsOrigins: ["https://trusted-agent.example.com"],
  auth: {
    type: "bearer",
    allowPublicRead: true,              // search is public; writes still require a token
  },
  verifier: async ({ token, scopes }) => {
    // Replace with your real token verification (Auth0, Clerk, custom JWT, etc.)
    const session = await verifyMyToken(token);
    if (!session) return { ok: false, reason: "Invalid token" };

    if (scopes?.length && !scopes.every((s) => session.scopes.includes(s))) {
      return { ok: false, reason: `Missing scope: ${scopes.join(", ")}` };
    }

    return { ok: true, principal: session.userId };
  },
  rateLimit: {
    maxRequests: 60,
    windowMs: 60_000,
    trustedProxyCount: 1,               // Vercel sits one hop in front
  },
  commands: {
    search: {
      description: "Search the site",
      safety: "read",
      params: { q: { type: "string", required: true } },
      handler: async ({ q }) => {
        const res = await fetch(`https://example.com/api/search?q=${encodeURIComponent(String(q))}`);
        return res.json();
      },
    },
    saveNote: {
      description: "Save a note for the authenticated user",
      safety: "write",                  // idempotent write — same (userId, noteId) has same effect
      idempotent: true,
      requiredScopes: ["notes:write"],
      params: {
        id:   { type: "string", required: true },
        body: { type: "string", required: true },
      },
      handler: async ({ id, body }, ctx) => {
        await db.notes.upsert(ctx.principal!, String(id), String(body));
        return { saved: true, id };
      },
    },
  },
});

// eslint-disable-next-line no-undef
export const { GET, POST } = morlockNext.nextjs();


// ── EXAMPLE 3: Agent using the client ────────────────────────────────────────

import { createClient } from "@morlock/core/client";

async function agentTask() {
  const client = createClient({ bearerToken: process.env.BLOG_TOKEN });

  // Single site
  const blog = await client.connect("https://myblog.com");
  console.log("Available commands:", blog.commands());
  // → ["getPosts", "getPost"]

  // `.run()` returns { result, replayed, idempotencyKey } — not the raw result.
  const { result: posts } = await blog.run("getPosts", { limit: 5, tag: "ai" });
  console.log("Latest AI posts:", posts);

  const { result: post } = await blog.run("getPost", { slug: "future-of-ai" });
  console.log("Post content:", post);

  // Write commands: the client generates and reuses an idempotency key automatically.
  // Retrying this call with the same key returns the original response without re-running
  // the handler — `replayed` tells you that happened.
  const { result: saved, replayed } = await blog.run("saveNote", {
    id:   "n_123",
    body: "Picked up groceries.",
  });
  console.log("Saved:", saved, "replayed:", replayed);

  // Multi-site discovery — non-Morlock sites are silently skipped.
  const sites = await client.connectMany([
    "https://myblog.com",
    "https://ecommerce-store.com",
    "https://news-site.com",
  ]);

  const searchableSites = sites.filter((s) => s.has("search"));

  const allResults = await Promise.all(
    searchableSites.map(async (site) => {
      const { result } = await site.run("search", { q: "artificial intelligence" });
      return { site: site.manifest.name, result };
    })
  );

  console.log("Cross-site search results:", allResults);
}

agentTask().catch(console.error);


// ── stubs referenced above (for type-check only) ─────────────────────────────

declare const db: {
  notes: { upsert(userId: string, id: string, body: string): Promise<void> };
};
declare function verifyMyToken(token: string): Promise<
  | { userId: string; scopes: string[] }
  | null
>;
