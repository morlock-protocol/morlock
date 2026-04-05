// ─────────────────────────────────────────────────────────────────────────────
// Morlock — Usage Examples
// ─────────────────────────────────────────────────────────────────────────────

// ── EXAMPLE 1: Express ───────────────────────────────────────────────────────

import express from "express";
import { createMorlock } from "@morlock/core/server";

const app = express();
app.use(express.json());

const morlock = createMorlock({
  name: "My Blog",
  baseUrl: "https://myblog.com",
  commands: {
    getPosts: {
      description: "List recent blog posts",
      params: {
        limit: { type: "number", default: 10 },
        tag: { type: "string", description: "Filter by tag" },
      },
      returns: "Array of post objects",
      examples: [
        {
          params: { limit: 3, tag: "ai" },
          result: [
            { slug: "future-of-ai", title: "The Future of AI", date: "2025-01-01" },
          ],
        },
      ],
      handler: async ({ limit, tag }) => {
        // your actual data fetching logic
        return [{ slug: "example", title: "Example Post", date: "2025-01-01" }];
      },
    },

    getPost: {
      description: "Get a specific blog post by slug",
      params: {
        slug: { type: "string", required: true },
      },
      handler: async ({ slug }) => {
        return { slug, title: "Example", content: "..." };
      },
    },

    subscribe: {
      description: "Subscribe to the newsletter",
      params: {
        email: { type: "string", required: true },
      },
      handler: async ({ email }) => {
        // add to mailing list
        return { subscribed: true, email };
      },
    },
  },

  rateLimit: { requests: 30, windowMs: 60_000 },

  onRequest: (req, ctx) => {
    console.log(`[morlock] ${req.command} from ${ctx.ip}`);
  },
});

app.use(morlock.express());
app.listen(3000);


// ── EXAMPLE 2: Next.js App Router ────────────────────────────────────────────

// File: app/api/agent/route.ts
import { createMorlock } from "@morlock/core/server";

const morlock = createMorlock({
  name: "My Next.js App",
  baseUrl: process.env.NEXT_PUBLIC_URL!,
  commands: {
    search: {
      description: "Search the site",
      params: {
        q: { type: "string", required: true },
      },
      handler: async ({ q }) => {
        const results = await fetch(`/api/search?q=${q}`).then((r) => r.json());
        return results;
      },
    },
  },
});

export const { GET, POST } = morlock.nextjs();


// ── EXAMPLE 3: Agent using the client ────────────────────────────────────────

import { createClient } from "@morlock/core/client";

async function agentTask() {
  const client = createClient();

  // Single site
  const blog = await client.connect("https://myblog.com");
  console.log("Available commands:", blog.commands());
  // → ["getPosts", "getPost", "subscribe"]

  const posts = await blog.run("getPosts", { limit: 5, tag: "ai" });
  console.log("Latest AI posts:", posts);

  const post = await blog.run("getPost", { slug: "future-of-ai" });
  console.log("Post content:", post);

  // Multi-site discovery
  const sites = await client.connectMany([
    "https://myblog.com",
    "https://ecommerce-store.com",
    "https://news-site.com",
  ]);

  // Find all sites that support search
  const searchableSites = sites.filter((s) => s.has("search"));

  // Run search across all of them in parallel
  const allResults = await Promise.all(
    searchableSites.map((site) =>
      site.run("search", { q: "artificial intelligence" }).then((results) => ({
        site: site.manifest.name,
        results,
      }))
    )
  );

  console.log("Cross-site search results:", allResults);
}

agentTask();
