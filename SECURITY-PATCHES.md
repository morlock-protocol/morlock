# Security Patches — @morlock/core

Version-by-version record of security-relevant fixes shipped in `@morlock/core`.

---

# v0.2.2

Launch-readiness pass. Two security-relevant changes on top of Batches 1–7 described in `PRODUCTION_CHANGELOG.md`.

## Medium — Idempotency-key DoS via unbounded keys

**Files:** `src/server/idempotency.ts` (updated)

### What was wrong

`checkIdempotency` accepted any string as the `X-Morlock-Idempotency-Key` header value. A 10 MB header value from a hostile client would be pinned in the in-memory store for 24 hours, and a sustained stream of large keys could exhaust memory.

### What changed

Added `isValidIdempotencyKey()` bounding keys to 1..255 chars of `[A-Za-z0-9_\-:.]`. Malformed keys are now rejected early with `422 INVALID_PARAMS` (distinct from `409 IDEMPOTENCY_KEY_REQUIRED` for missing keys — the discriminator is on the `checkIdempotency` result).

Covered by `tests/idempotency.test.ts: key validation rejects empty / too-long / bad-char`.

## Medium — Body size DoS in Next.js and fetch adapters

**Files:** `src/server/index.ts` (updated)

### What was wrong

The Next.js and fetch adapters called `await request.json()` with no size ceiling. A malicious 50 MB body would be parsed into memory unconditionally, blocking the event loop.

### What changed

Added `MorlockConfig.maxBodyBytes` (default 256 KiB). Both adapters now route JSON parsing through a new `readJsonBody()` that:
1. Fast-path rejects on `Content-Length > limit`.
2. Drains the stream to text with a size check after.
3. JSON-parses the bounded text.

Oversized bodies return `413` (Payload Too Large) with `INVALID_PARAMS`. Empty bodies return `400`.

The Express adapter still defers to `express.json({ limit })` — the Node idiom — and returns an actionable 400 if body parsing was not installed upstream.

---

# v0.2.1

Three follow-up fixes to v0.2.0, caught during a post-publish audit. All are on the server path.

## High — Rate-limit IP spoof in Next.js and fetch adapters

**Files:** `src/server/index.ts` (updated)

### What was wrong

v0.2.0 introduced `resolveClientIp()` with `trustedProxyCount` — but the Next.js and `fetch()` adapters bypassed it. Both pre-parsed `x-forwarded-for` with `.split(",")[0].trim()` and assigned the leftmost entry to `ctx.ip` before `checkRateLimit()` ran. That reopened exactly the spoof the module was built to close: any caller could set `X-Forwarded-For: <random>` and get a fresh rate-limit bucket per request.

### What changed

Next.js `POST` and `fetch()` `POST` now set `ctx.ip = undefined`. `resolveClientIp()` then decides based on `trustedProxyCount` + the raw XFF from headers. With the default `trustedProxyCount: 0`, edge-runtime deployments share a single `"unknown"` bucket — blunt but honest. Deployers behind Cloudflare/Vercel/etc. set `trustedProxyCount: 1` and get correct per-client limiting.

The Express adapter was already correct (uses `req.socket.remoteAddress`).

## High — Idempotent retries re-executed on handler failure

**Files:** `src/server/index.ts` (updated)

### What was wrong

v0.2.0 only called `recordIdempotency()` in the success branch. A handler that produced a side effect and *then* threw (card charged, email sent, subsequent write failed) would get re-executed on retry. The protocol's own idempotency promise didn't hold when it mattered most.

The cached-response replay branch was also storing only `{ result }`, losing the full response shape for failures.

### What changed

Both success and failure responses are now recorded under the idempotency key. Retries of a failed handler return the exact original failure verbatim with `meta.idempotentReplayed: true` — the side effect is not re-run. The stored body is now the full `MorlockResponse` rather than a partial wrapper.

## Medium — Missing body guard in Express adapter; unguarded JSON parse in Next.js / fetch

**Files:** `src/server/index.ts` (updated)

### What was wrong

The Express adapter assumed `req.body` was pre-parsed JSON. If `express.json()` wasn't installed, `execute()` crashed on `undefined.command` with no actionable error. The Next.js and `fetch()` adapters called `await request.json()` without a try/catch — invalid JSON bodies surfaced as unhandled promise rejections.

### What changed

- Express adapter returns `400 INVALID_PARAMS` with a message pointing at `express.json()` when `req.body` is missing.
- Next.js and `fetch()` adapters wrap `request.json()` in try/catch and return `400 INVALID_PARAMS` on parse failure.

---

# v0.2.0

## Summary

Four new modules, two updated modules. One critical fix, three high/medium fixes.

---

## Critical — Auth declared but not enforced

**Files:** `src/server/auth.ts` (new), `src/server/index.ts` (updated)

### What was wrong
`manifest.auth` was schema-validated and returned in the discovery manifest,
but `Morlock.execute()` never checked it during request handling. A developer
who set `auth: { type: "bearer" }` and registered protected commands had no
actual protection.

### What changed

1. `validateAuthConfig()` runs at server startup (in the `Morlock` constructor). If
   `auth.type !== "none"` and no `verifier` function is provided, the process throws:

   ```
   [morlock] CONFIGURATION ERROR: auth.type is "bearer" but no auth verifier
   was provided. Refusing to start with declared auth that is not enforced.
   ```

   **Fail-closed. Not fail-open.**

2. `enforceAuth()` runs before every command dispatch. It:
   - Extracts `Authorization: Bearer ...` or `X-Api-Key` headers
   - Calls the developer-supplied `verifier(req)` function
   - Returns 401 (no credential) or 403 (credential rejected)

3. The `verifier` signature is explicit and typed:

   ```ts
   type AuthVerifier = (req: {
     type: "bearer" | "apikey" | "oauth2";
     token: string;
     scopes?: string[];
     command: string;
   }) => Promise<{ ok: true; principal?: string } | { ok: false; reason: string }>;
   ```

### Migration

```ts
// Before (broken — auth declared but not enforced)
createMorlock({
  name: "Acme Store",
  baseUrl: "https://acme.com",
  auth: { type: "bearer" },
  commands: { ... }
})

// After — verifier required or startup throws
createMorlock({
  name: "Acme Store",
  baseUrl: "https://acme.com",
  auth: { type: "bearer" },
  verifier: async ({ token, command }) => {
    const user = await myTokenStore.verify(token);
    if (!user) return { ok: false, reason: "Invalid token" };
    return { ok: true, principal: user.id };
  },
  commands: { ... }
})
```

---

## High — No replay/idempotency model for write commands

**Files:** `src/server/idempotency.ts` (new), `src/shared/types.ts` (updated), `src/server/index.ts` (updated), `src/client/index.ts` (updated)

### What was wrong
The spec told agents to retry on network errors. Commands like `addToCart`,
`checkout`, `bookSlot` could execute multiple times under retry.
`requestId` existed for tracing, not deduplication.

### What changed

1. `CommandSchema` now has a `safety` field: `"read" | "write" | "unsafe"`.
   Default is `"unsafe"` (safe default — assume side effects).

2. Non-read commands require an `X-Morlock-Idempotency-Key` header by default.
   Without it, they get `409` with `IDEMPOTENCY_KEY_REQUIRED`.

3. The server stores successful responses keyed by idempotency key.
   Duplicate requests within the dedup window get the cached response with
   `meta.idempotentReplayed: true`.

4. The `IdempotencyStore` interface is pluggable:

   ```ts
   // Default: in-memory (single process)
   // Production: plug in Redis/Upstash/KV
   interface IdempotencyStore {
     get(key: string): Promise<IdempotencyRecord | null>;
     set(key: string, record: IdempotencyRecord, ttlMs: number): Promise<void>;
   }
   ```

5. The client SDK (`MorlockSite.run()`) now automatically generates an idempotency
   key for non-read commands and reuses it across retries.

### Migration — command definitions

```ts
// Before
{ description: "Add item to cart", params: { ... } }

// After — explicit safety annotation
{
  description: "Add item to cart",
  safety: "unsafe",          // has side effects, not idempotent
  requiredScopes: ["cart"],  // optional, for fine-grained OAuth2
  params: { ... }
}

// Read-only (no auth or idempotency key needed if allowPublicRead)
{ description: "Get product details", safety: "read", params: { ... } }

// Idempotent write (key recommended but not strictly required)
{ description: "Set preference", safety: "write", idempotent: true, params: { ... } }
```

---

## High — Rate limiting trusted x-forwarded-for naively

**Files:** `src/server/rate-limit.ts` (new), `src/server/index.ts` (updated)

### What was wrong
Rate limiting keyed off `x-forwarded-for` directly (in the Next.js adapter)
or `req.ip` (Express, which may also trust XFF). Attackers could spoof XFF
to cycle IP identities and bypass limits.

### What changed

1. `resolveClientIp()` takes an explicit `trustedProxyCount`:
   - `0` (default): use socket IP, ignore XFF entirely
   - `n`: trust the rightmost `n` XFF entries, use the next one as the real client IP

2. `MorlockConfig.rateLimit.trustedProxyCount` exposes this to deployers.

3. Documentation states in-memory rate limiting is per-process
   and should not be treated as a security control in multi-instance deployments.

### Migration

```ts
createMorlock({
  // ...
  rateLimit: {
    maxRequests: 60,
    windowMs: 60_000,
    trustedProxyCount: 1, // Vercel/Cloudflare/Railway: 1 is usually correct
  }
})
```

---

## Medium — Over-broad default CORS

**Files:** `src/server/index.ts`

### What was wrong
The fetch adapter hardcoded `Access-Control-Allow-Origin: *`.
Correct for fully public read-only endpoints; wrong as a blanket default.

### What changed

- `MorlockConfig.corsOrigins` defaults to `[]` (no cross-origin access).
- CORS is now applied consistently across all three adapters (Express, Next.js, fetch).
- Deployers opt in explicitly:

  ```ts
  corsOrigins: "*"                          // fully public read-only manifest
  corsOrigins: ["https://trusted.app.com"]  // explicit allowlist
  ```

---

## Medium — Command enumeration in errors

**Files:** `src/server/index.ts`

### What was wrong
Unknown command errors returned the command name and listed all available
commands: `"Unknown command: 'adminNuke'. Available: ..."` — confirms to
attackers which commands exist.

### What changed

Returns generic `404 { error: "UNKNOWN_COMMAND", message: "Command not found." }` for any
unrecognised command name. The manifest discovery endpoint already documents all
public commands; there's nothing to gain from confirming unknown ones.

---

## Not changed (punted)

- **In-memory rate limiting durability**: documented as advisory, not fixed to be distributed.
  The `RateLimiterStore` interface is there for deployers who need it.

- **In-memory idempotency store durability**: same reasoning. Interface is pluggable.

---

## Breaking changes

- Commands without a `safety` annotation default to `"unsafe"`, requiring auth
  and an idempotency key. Add `safety: "read"` to commands that are read-only.
- `corsOrigins` defaults to `[]` — previously `*`. Set explicitly if needed.
- `auth.type !== "none"` now requires a `verifier` function or startup throws.
- `MorlockSite.run()` now returns `MorlockRunResult` instead of raw `unknown`.
