# Security Review — @morlock/core

Audit date: 2026-04-16. Reviewed version: targeting `0.2.2`.

This document summarizes the security posture of `@morlock/core` after the launch-readiness pass. It complements [SECURITY-PATCHES.md](./SECURITY-PATCHES.md) (version-scoped fix log) and [SECURITY.md](./SECURITY.md) (disclosure policy).

## Threat model

The library is a stateless request router + security pipeline that sits on the consumer's HTTP server. It processes requests from three classes of caller:

1. **Honest AI agents** — read the manifest, invoke commands, retry with idempotency keys.
2. **Manifest crawlers / benign probers** — check `/.well-known/morlock` on many sites.
3. **Hostile clients** — probing for enumerable commands, spoofing IPs to bypass rate limits, replaying write commands to double-charge, sending oversized bodies to exhaust memory.

Assets we protect:

- **Handler execution authority** — a command handler is arbitrary code; unauthorized invocation is the primary risk.
- **Deduplication integrity** — retries must not cause duplicate side effects.
- **Availability** — per-IP rate limits must not be trivially bypassed; resource use per request is bounded.
- **Command catalog privacy** — attackers shouldn't be able to enumerate commands that aren't in the manifest.

Out of scope:

- Host-framework vulnerabilities (Express bugs, Next.js issues).
- Certificate / TLS handling (consumer's responsibility).
- DoS resilience beyond per-IP rate limits (handled at infra layer).
- Supply-chain compromise of the npm package itself — mitigated by npm provenance (when enabled), not code.

## Controls implemented

| # | Control | Where | Tested by |
|---|---|---|---|
| 1 | **Fail-closed auth** — declared `auth.type !== "none"` without a `verifier` throws at startup | [src/server/auth.ts:119-132](src/server/auth.ts:119) | `auth.test.ts: validateAuthConfig` |
| 2 | **Per-request auth enforcement** — every non-read (or read without `allowPublicRead`) command goes through `enforceAuth` | [src/server/auth.ts:74-112](src/server/auth.ts:74) | `morlock.test.ts: missing auth / verifier rejects` |
| 3 | **Safety-driven defaults** — commands default to `"unsafe"` (auth + idempotency required), not `"read"` | [src/shared/types.ts:22](src/shared/types.ts:22) | integration tests exercise default |
| 4 | **Generic 404 on unknown command** — error message never names valid commands | [src/server/index.ts:232-241](src/server/index.ts:232) | `morlock.test.ts: unknown command returns generic 404 — no enumeration` |
| 5 | **Pipeline ordering** — rate limit → lookup → auth → idempotency → validate → execute. Authentication failures are surfaced only after 404 and rate-limit checks | [src/server/index.ts:195-335](src/server/index.ts:195) | `morlock.test.ts: pipeline order` |
| 6 | **Idempotency on success AND failure** — handler that throws after partial side-effects is not re-run on retry | [src/server/index.ts:339-382](src/server/index.ts:339) | `morlock.test.ts: duplicate idempotency key replays cached FAILURE intact` |
| 7 | **Idempotency key bounds** — 1..255 chars of `[A-Za-z0-9_\-:.]`. Malformed keys returned as `INVALID_PARAMS` (422), not silently truncated | [src/server/idempotency.ts:97-108](src/server/idempotency.ts:97) | `idempotency.test.ts: key validation` |
| 8 | **XFF spoof prevention** — `trustedProxyCount` defaults to 0 (ignore XFF). Next.js and fetch adapters pass `ip = undefined` so they can't leak leftmost XFF into rate-limit keys | [src/server/rate-limit.ts:109-129](src/server/rate-limit.ts:109), [src/server/index.ts:464-502](src/server/index.ts:464) | `rate-limit.test.ts: trustedProxyCount` suite |
| 9 | **Body size cap** — Next.js/fetch adapters cap at `maxBodyBytes` (default 256 KiB). `Content-Length` fast-path + streaming cap both enforced; oversized returns 413 | [src/server/index.ts:361-389](src/server/index.ts:361) | visual (no network test) |
| 10 | **Deep param validation** — `minLength` / `maxLength` / `pattern` for strings, `min` / `max` + NaN/Infinity reject for numbers, `maxItems` for arrays, null-safe type check | [src/server/index.ts:540-631](src/server/index.ts:540) | `validate.test.ts` (16 tests) |
| 11 | **CORS defaults deny** — `corsOrigins` defaults to `[]`. Wildcard `"*"` permitted but logged as a warning when combined with write/unsafe commands | [src/server/index.ts:142-151](src/server/index.ts:142), [src/server/index.ts:441-471](src/server/index.ts:441) | construct-time warning is visible; explicit test deferred |
| 12 | **`Vary: Origin` everywhere** — emitted on wildcard, allowlist, and fallback CORS paths → prevents CDN cross-origin cache bleed | [src/server/index.ts:441-471](src/server/index.ts:441) | visual |
| 13 | **Generic error messages** — command-failure errors pass through `Error.message` only (no stack, no introspection). Non-`Error` throws get a generic fallback | [src/server/index.ts:353-366](src/server/index.ts:353) | `morlock.test.ts: handler throws a non-Error → generic fallback` |
| 14 | **Empty / invalid JSON body** — rejected with `400 INVALID_PARAMS`, not crash | [src/server/index.ts:410-424](src/server/index.ts:410) | visual |

## Remaining risks

### R1 — In-memory stores are per-process (MEDIUM, by design)

The default `InMemoryRateLimiterStore` / `InMemoryIdempotencyStore` are per-process singletons. Two processes of the same service do not share buckets. For honest deployers this is "just less effective rate limiting," not a security bypass; for a determined attacker running 5 parallel connections against a 5-replica service, the effective limit is 5× what the manifest declares.

**Mitigation:** documented. Consumers running in production with >1 replica should plug in a Redis/KV store. CI should verify (future work) that `corsOrigins: "*"` + multi-replica + default store doesn't silently ship to prod.

### R2 — `pattern` regex is user-supplied (LOW)

A hostile `manifest` could declare a catastrophic-backtrack regex on a command's `pattern`. This is not a remote exploit — the `manifest` is authored by the site owner, not the caller — but it means an insider could DoS their own server. No fix in code; won't accept regex patterns from untrusted sources.

### R3 — Single in-memory store, single timer (LOW)

The `defaultStore` module-level singletons shared across `Morlock` instances means one misconfigured site could blow out the store for another running in the same process. Pathological multi-tenant use only. Explicit `store: new InMemoryIdempotencyStore()` per instance closes this.

### R4 — No request-duration timeout (LOW)

A handler that never resolves holds open the request. The library doesn't impose a hard ceiling — it defers to the host runtime (Cloudflare Workers has a 30s cap; Node has none by default). Documented in RUNBOOK.

### R5 — No response-body size cap (LOW)

A buggy handler returning `new Array(1e8).fill(0)` will be JSON-serialized and streamed. No output cap. Same rationale as R4 — punt to the runtime for now.

## Recommendations

For consumers deploying `@morlock/core` to production:

1. Plug in a shared-state rate-limit and idempotency store (Redis/KV).
2. Set `trustedProxyCount` explicitly, matching your actual deployment topology. Never guess.
3. Hook `onAuthFailure` / `onRateLimit` / `onError` into your observability platform. Do the I/O asynchronously — these callbacks are synchronous and block the request path.
4. Set `corsOrigins` to an explicit allowlist. Use `"*"` only if the manifest is fully public, unauthenticated, read-only.
5. Review your command `safety` annotations. Any command missing one defaults to `"unsafe"` and will 409 without an idempotency key — loud, but safer than silently allowing writes.
6. Check `npm audit` on your server dependencies (not on `@morlock/core`, which has zero runtime deps).
7. Use npm provenance. If you fork, set up trusted publishing on your own package.
