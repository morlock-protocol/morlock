# Security Patches — @morlock/core v0.2.0

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
