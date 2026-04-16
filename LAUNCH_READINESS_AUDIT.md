# Launch Readiness Audit — Morlock Protocol

**Audit date:** 2026-04-16
**Scope:** `@morlock/core` (library, published to npm) + `@morlock/cli` (CLI, unpublished) + protocol spec v0.2.

---

## 1. Product summary

Morlock is an open HTTP protocol + reference TypeScript library that lets websites expose structured, typed, agent-callable commands via `/.well-known/morlock`. It is positioned as "robots.txt for agents" — site owners drop in middleware, AI agents discover capabilities and invoke them without vision/DOM parsing.

**Shipped surface:**

- `@morlock/core` — TypeScript library. Versions on npm: `0.1.0` (legacy), `0.2.0` (current latest), `0.2.1` (pending this session's fixes).
  - `./server` — framework-agnostic middleware with adapters for Express, Next.js, Cloudflare Workers, Bun, Deno.
  - `./client` — agent-side SDK (manifest discovery + command invocation).
- `@morlock/cli` — not yet published. Exposes `morlock quickstart | ping | badge`.
- `spec/v0.2.md` — the wire format & normative protocol text. Cited from README.
- Landing page at `morlocks.dev` (not in this repo).

**Core user journeys:**

| Who | Journey |
|---|---|
| Site owner | `npm i @morlock/core` → `createMorlock({ commands })` → `app.use(morlock.express())` → `/.well-known/morlock` is live. |
| Site owner (onboarding) | `npx @morlock/cli quickstart` → interactive walkthrough → paste code snippet. |
| Site owner (verify) | `npx @morlock/cli ping <domain>` → shows manifest health. |
| Agent author | `createClient().connect(url)` → `site.run("cmd", args)` → typed result. |

## 2. Architecture summary

**Stack:** TypeScript (strict), CJS output, zero runtime dependencies (library), no runtime deps in CLI either. Node ≥ crypto.randomUUID (Node 19+ without polyfill, Node 14.17+ with `crypto.randomUUID`). Edge-runtime fetch for Workers/Bun/Deno.

**Layering (core):**

```
 src/server/index.ts          orchestrator (Morlock class, adapters)
 ├─ src/server/auth.ts        startup validation + per-request enforcement
 ├─ src/server/idempotency.ts replay protection + pluggable store
 ├─ src/server/rate-limit.ts  per-IP limiter + pluggable store
 └─ src/shared/types.ts       wire-format types (manifest, requests, errors)

 src/client/index.ts          discovery + invocation SDK (standalone)

 src/index.ts                 root re-export (server.* + client.* + shared types)
```

**Security pipeline (per request):** rate limit → command lookup (generic 404) → auth → idempotency → param validation → execute → record idempotency (success or failure).

**Default stores** (in-memory, single-process): module-level singletons. Pluggable interfaces exist for Redis/KV replacement.

**Deploy model:** library-only — consumers own the HTTP server. No infra we operate as part of the core package. The `morlocks.dev` landing/registry is a separate concern.

## 3. Launch blockers

Ranked by impact on "can a serious startup ship on this today."

### B1. CLI `quickstart` lies to the user (P0 — trust/integrity)

The interactive walkthrough:
- **Pretends to run `npm install`** with a fake spinner and fake "added 1 package in 0.8s" output. No install actually happens.
- **Shows a manifest with invalid fields** (`"version"`, `"transport"`) that aren't in the spec.
- **Shows a config shape that does not exist** (`commands: [ ... ]` as an array, but real schema is `Record<string, CommandSchema>`).
- **References `@morlock/openclaw`** — a package that does not exist on npm.
- **Generates invalid command code** (`input: { query: string }` but real field is `params`).

Copying the onboarding code verbatim produces a non-compiling program. This is a credibility blocker for a protocol that sells itself on "drop in and it works."

### B2. No tests. Zero. (P0 — correctness + regression risk)

Security-critical code (auth enforcement, rate limiting, idempotency replay) has no automated coverage. Every v0.2.0 → v0.2.1 fix from this session could regress silently on the next refactor. Not shippable for paying customers without at least a critical-path test suite.

### B3. No CI, no release gating (P0 — operational)

No `.github/workflows`. `npm publish` runs at will from any maintainer's laptop. No typecheck-on-PR, no test-on-PR, no dependency audit.

### B4. README documents v0.1 insecure behaviour (P0 — security docs contradict code)

`README.md:159` explicitly shows an `UNKNOWN_COMMAND` error that enumerates valid command names — the exact anti-pattern v0.2 §12 forbids and v0.2.0 fixed. Anyone building against the README will assume they can enumerate. Must be corrected before 0.2.1 tarball ships (npm pulls the README from the tarball).

### B5. README examples teach unsafe defaults (P0 — security posture)

- All `commands` in README examples omit `safety:` annotations → default to `"unsafe"` → require auth + idempotency. Examples don't configure auth → a user copying the README hits a `409 IDEMPOTENCY_KEY_REQUIRED` wall on their first request and cannot figure out why.
- No `verifier` example in the Auth section → users who declare `auth: { type: "bearer" }` get a **startup crash** per our new fail-closed check, and the README gives them no path forward.
- No `trustedProxyCount` docs → deployers on Vercel/Cloudflare silently get one shared `"unknown"` rate-limit bucket.

### B6. `client.run()` return shape contradicts every example (P0 — DX defect)

`site.run(...)` returns `{ result, replayed, idempotencyKey }` (typed `MorlockRunResult`). Both [README.md](README.md) and [examples/usage.ts](examples/usage.ts) use the return value as if it were the raw result (`const posts = await blog.run(...); console.log(posts)` — logs the wrapper, not the data). Every example is wrong.

### B7. `@morlock/cli` packaging not publish-ready (P1)

- No `files` field → would ship `src/` and `tsconfig.json`.
- No `publishConfig.access: public` on a scoped package → `npm publish` without `--access public` fails silently for humans.
- No `description`, `keywords`, `repository`, `homepage`.
- No README → npm page would be blank.
- Dual bins (`morlock` + `quickstart`) — `quickstart` is too generic to claim the global bin namespace.
- CLI `package.json` has no explicit dependency on `@morlock/core`. The `ping` and `badge` commands use `node:https` directly (fine), but the README-generated snippets advertise `@morlock/core`. User's `npx @morlock/cli` session doesn't force a core install.

### B8. Lockfile drift (P1)

Root `package-lock.json` still has `@morlock/core: 0.1.0` as a dep node, left over from the self-dependency that existed in v0.2.0's manifest. Should be regenerated after the dep removal.

## 4. Major risks

### R1. Default in-memory stores are module-level singletons

[src/server/rate-limit.ts:133](src/server/rate-limit.ts:133), [src/server/idempotency.ts:153](src/server/idempotency.ts:153). Two `Morlock` instances in one process share buckets. Not a bug for the 99% case (one instance per process) but bites anyone running multi-tenant SaaS mounting multiple `Morlock` per request. Mitigation: document, or instantiate per `Morlock`.

### R2. Rate limit `resetAt` is wall-clock, not bucket-accurate

[src/server/rate-limit.ts:152](src/server/rate-limit.ts:152). `resetAt = Date.now() + windowMs` is computed on every check — advertised reset time marches forward continuously. Agents polling status see a reset that never arrives. `InMemoryRateLimiterStore.getResetAt` exists for this but is dead code.

### R3. Rate-limit `maxRequests` can go negative

`increment` counts unconditionally, including on rejected requests. Under sustained abuse, `remaining` goes sharply negative. Self-heals at rollover. Cosmetic but surfaces in the API.

### R4. Rate-limit headers not emitted as HTTP headers

Spec v0.2 §9.3 says sites SHOULD emit `X-RateLimit-Remaining` / `X-RateLimit-Reset` HTTP headers. The code only sets them in `meta` of the JSON body. Adapters would need to forward them.

### R5. `validateParams` type check is minimal

[src/server/index.ts:447-470](src/server/index.ts:447). No deep type validation for `"object"` / `"array"` shape, no regex for strings, no min/max for numbers. Accepts `null` as `object`. Trivially bypassable for any non-trivial command schema. Consumers expecting Zod-grade validation will be surprised.

### R6. No request size limit

`request.json()` will happily parse a 50 MB POST. Body-size cap is deferred to the host framework (Express users can set `express.json({ limit: "1mb" })` — but most don't). Risk of memory-exhaustion from unbounded requests. Ideally the core should cap or warn.

### R7. CORS wildcard path is missing `Vary: Origin`

Only cosmetic/cache-hygiene. But a shared CDN in front of a Morlock endpoint configured with `corsOrigins: "*"` could serve one client's response to another. Low risk in default config (wildcard explicit opt-in), still worth fixing.

### R8. No structured logging / telemetry hooks

`onRequest` and `onError` exist but no `onResponse`, no duration breakdown, no rate-limit rejection hook, no auth rejection hook. Operators will black-box-debug production issues.

### R9. No version negotiation on the client side

Client fetches the manifest, checks `morlock` and `commands` exist, then invokes blindly. If a site ships `"morlock": "0.3"` with breaking wire changes, the client silently tries anyway. Spec §11 says agents MUST check — code doesn't.

### R10. Idempotency key length / format not bounded

A caller can send `X-Morlock-Idempotency-Key: <10MB of garbage>` as a map key and force the in-memory store to hold it for 24h. No input length validation.

## 5. Quick wins

High leverage, low-cost fixes that land before blockers:

- **QW1.** Strip the "command enumeration" example from README (B4) — single line, eliminates a security contradiction.
- **QW2.** Fix README + examples `run()` return-shape (B6) — maybe 10 lines of diff.
- **QW3.** Add `safety:` annotations to every example (partial B5) — tells users the real API.
- **QW4.** Remove `@morlock/openclaw` reference from the CLI (part of B1) — delete one line.
- **QW5.** Drop `quickstart` as a global bin name (B7) — keep only `morlock`.
- **QW6.** Add `Vary: Origin` to the CORS wildcard path and the fallback path (R7) — trivial.
- **QW7.** Add rate-limit HTTP headers to adapter responses (R4) — pass through `meta.rateLimitRemaining/Reset`.
- **QW8.** Bound idempotency key to 255 chars, character class `[A-Za-z0-9_\-:.]` (R10).
- **QW9.** Regenerate `package-lock.json` (B8).
- **QW10.** Fix rate-limit reset to reflect the actual bucket window (R2).

## 6. Recommended execution plan

Ordered by descending leverage. Each batch ends with a commit and a `PRODUCTION_CHANGELOG.md` entry.

### Batch 1 — Truth-in-docs + CLI integrity (fixes B1, B4, B5, B6, QW1-5)

Don't ship a new version until the docs stop contradicting the code. The CLI quickstart either gets a full rewrite to match reality, or gets gutted to a non-lying minimum. Given the scope — full rewrite. Also: fix the README, fix examples, add the missing security knobs (`verifier`, `trustedProxyCount`, `corsOrigins`, `allowPublicRead`) to the docs.

### Batch 2 — Hardening: input validation + runtime guards (fixes R5, R6, R7, R10, QW6, QW8)

Request size cap, idempotency-key bounds, deeper param validation (array/object recognition, string regex where declared, number bounds). CORS `Vary: Origin` everywhere.

### Batch 3 — Observability + rate-limit fidelity (fixes R2, R3, R4, R8, QW7, QW10)

Emit HTTP rate-limit headers from all three adapters. Fix `resetAt` to reflect bucket state. Add `onAuthFailure`, `onRateLimit`, `onIdempotencyReplay` hooks.

### Batch 4 — Test suite (fixes B2)

Hit every branch of the security pipeline. Mock stores. Cover: unknown command → 404 generic; missing auth → 401; bad auth → 403; missing idempotency key on write → 409; duplicate key → replay; successful request → 200 with meta; handler throws → 500 + idempotency still recorded; rate limit exceeded → 429; proxy-trust IP resolution.

Target: ~30 focused tests, not a Kubernetes-grade matrix. Use `node:test` — zero extra deps.

### Batch 5 — CI / ops (fixes B3)

`.github/workflows/ci.yml` running lint (tsc --noEmit), build, test on Node 18/20/22. `.github/workflows/publish.yml` with OIDC trusted publish (no long-lived npm token). `SECURITY.md`. `CODEOWNERS`.

### Batch 6 — CLI publish prep (fixes B7)

`files` allowlist, `publishConfig.access`, README, `description`, `keywords`, drop second bin, add `@morlock/core` as a peer dep. Do **not** publish in this session — leave for a follow-up.

### Batch 7 — Finalize packaging + docs + publish dry-run

`PRODUCTION_CHANGELOG.md`, `SECURITY_REVIEW.md`, `TECH_DEBT_BACKLOG.md`, `RUNBOOK.md`. Final `npm publish --dry-run` for both packages. Commit. Push to main. User publishes `@morlock/core@0.2.2` themselves (the session's 0.2.1 was already consumed by infrastructure-only changes; docs/behavior changes here warrant a fresh patch).

### Explicit non-goals for this session

- Rewriting the spec (v0.2 stays).
- Writing new framework adapters (Fastify/Hono are roadmap).
- Building `@morlock/registry` or `@morlock/analytics`.
- Publishing anything to npm (user holds the publish trigger).
- Refactoring for an ESM/dual build (single CJS output is fine for 0.2.x).

---

## Readiness status

| Area | Before | After batch 4 | After batch 7 |
|---|---|---|---|
| Security (defense-in-depth) | 7/10 | 7/10 | 8.5/10 |
| Docs truth | 4/10 | 9/10 | 9/10 |
| DX (first-run success) | 3/10 | 8/10 | 9/10 |
| Test coverage | 0/10 | 7/10 | 7/10 |
| Ops/release | 2/10 | 2/10 | 7/10 |
| Observability | 3/10 | 3/10 | 6/10 |

Launch readiness when batches 1-5 are done. Batches 6-7 pave the runway for `@morlock/cli` v0.3 and `@morlock/core` v0.3 without further rework.
