# Tech Debt Backlog

Non-blocking issues not fixed during the launch-readiness pass. Tracked here so they don't slip through the cracks. Prioritized by (severity × leverage).

Legend:
- **Severity:** Low = polish, Medium = user-visible friction, High = security/correctness concern that deserves a fix but isn't a blocker.
- **Effort:** T-shirt sized.

## High priority

### HT-1. OIDC trusted publisher setup on npmjs

- **Severity:** Medium
- **Effort:** XS (one-time config on npmjs.com)
- **Why:** `publish-core.yml` is wired for OIDC provenance. Without trusted publisher configured on the npm package side, it falls back to `NPM_TOKEN`. Long-lived tokens are a supply-chain risk; OIDC provenance is the modern baseline.
- **Action:** npmjs.com → `@morlock/core` → Publishing settings → Trusted publisher: GitHub Actions in `morlock-protocol/morlock`, workflow `publish-core.yml`, env `npm-publish`.

### HT-2. Replace `CODEOWNERS` placeholder

- **Severity:** Medium (won't block PRs, but auto-review assignment won't work)
- **Effort:** XS
- **Why:** `.github/CODEOWNERS` uses `@werner-mnm` as a placeholder; real GitHub handle needs to go in before branch-protection rules can use it.

### HT-3. Branch protection on `main`

- **Severity:** Medium
- **Effort:** XS (repo settings, not code)
- **Why:** Without branch protection, "require CI passing" + "require review" are aspirational. Runbook documents the setup; needs to happen in GitHub settings.

### HT-4. Rate-limit + idempotency header-based auth separation

- **Severity:** Medium
- **Effort:** S
- **Why:** Rate limit keys off IP only. An authenticated caller sharing an IP (corporate NAT, agent farm) can't have their own bucket. Common mitigation: rate-limit by `principal` when authed, else by IP. Requires principal to be resolved before rate-limit — which currently isn't the order.
- **Risk of changing:** Moving rate limit past auth means unauthed probers would hit auth checks and fail at 401 before they see 429. That's fine. But re-ordering the pipeline is a spec concern; discuss before shipping.

## Medium priority

### MT-1. HTTP-layer integration tests

- **Severity:** Medium
- **Effort:** M
- **Why:** Current tests exercise `Morlock.execute()` directly. The three adapters (Express, Next.js, fetch) have logic (body reading, `req.body` guard, redirects) that isn't covered. Miniature test fixtures: a real Node HTTP server for Express, a crafted `Request` for Next.js and fetch.

### MT-2. Client-SDK tests

- **Severity:** Medium
- **Effort:** M
- **Why:** `MorlockClient.connect`, `.connectMany`, `MorlockSite.run` retry/backoff — untested. Would need a fetch-mock harness.

### MT-3. CLI command tests (`ping`, `quickstart`)

- **Severity:** Low (both are small)
- **Effort:** S
- **Why:** `ping` has redirect logic that's easy to break. A single test hitting a fake HTTP server with Location headers would cover it.

### MT-4. Distinguish `RATE_LIMITED` from other 4xx in the client

- **Severity:** Medium
- **Effort:** S
- **Why:** The client currently throws `MorlockClientError` on any 4xx and doesn't retry. 429 should honor `X-RateLimit-Reset` or at least the `Retry-After` header if present.

### MT-5. Client request-response size caps

- **Severity:** Low
- **Effort:** XS
- **Why:** A malicious or bloated manifest could be unbounded. `MorlockClient.connect` should cap manifest bytes.

### MT-6. `examples/usage.ts` isn't built or tested

- **Severity:** Low
- **Effort:** S
- **Why:** The file uses real Express/Next types but is never compiled in CI. A `tsconfig.examples.json` that `noEmit`s it would catch drift between README snippets and the library's actual API.

## Low priority / deferred

### LT-1. Rate-limit bucket stores in `Morlock` instance, not module-level

- **Severity:** Low
- **Effort:** S
- **Why:** `defaultStore` at module level means multiple `Morlock` instances in one process share a bucket. Not a bug per se, but surprising.

### LT-2. `pattern` regex compilation cache

- **Severity:** Low
- **Effort:** S
- **Why:** `validateParamsAgainst` compiles the regex on every call. For hot paths (100+ rps per command with a `pattern`), this is measurable. Cache per-command in a WeakMap on the first access.

### LT-3. Manifest caching in client with TTL / ETag

- **Severity:** Low
- **Effort:** S
- **Why:** `MorlockClient` caches manifests for the session forever. Real agents running for days would benefit from a TTL and conditional GETs. Not essential for v0.2.

### LT-4. Redirect handling in `MorlockClient.connect`

- **Severity:** Low
- **Effort:** XS
- **Why:** The CLI `ping` now follows redirects. The library client uses `fetch` which follows redirects by default — but we don't surface the `finalUrl` back to the caller. Worth exposing so consumers can detect domain drift.

### LT-5. Structured logging format standardization

- **Severity:** Low
- **Effort:** S
- **Why:** Current hooks pass plain objects. An optional `logger` config (pino-style) would help consumers wire into their pipeline.

### LT-6. Spec v0.2 doesn't define `X-RateLimit-*` header format

- **Severity:** Low
- **Effort:** S
- **Why:** We emit epoch-seconds `X-RateLimit-Reset` (common convention). The spec should codify this so other implementations don't diverge.

### LT-7. Morlock lore tone consistency

- **Severity:** Low
- **Effort:** XS
- **Why:** The library error messages ("Nothing stirs in the dark", "The gears jammed", "The machinery needs rest") are charming in a CLI or landing page, less so in a production API response surfaced to a paying agent operator who's debugging at 3am. Consider a `playfulMessages: false` option or default-off.

### LT-8. Single-bin CLI missing subcommand aliases

- **Severity:** Low
- **Effort:** XS
- **Why:** `morlock --help` / `-h` are wired. `morlock -v` / `--version` are not.

### LT-9. Badge service

- **Severity:** Low (removed from README + CLI in Batch 1)
- **Effort:** depends
- **Why:** `https://morlocks.dev/badge/<domain>` is advertised nowhere in this repo now, but it's on the product roadmap. When built, the CLI `badge` command can be restored.

### LT-10. Spec v0.3 candidate items

- **Severity:** N/A (future)
- `safety` should be required, not optional (remove the "default unsafe" dance)
- Define `X-RateLimit-*` header format normatively
- Define request-id propagation (`X-Morlock-Request-Id`)
- Maybe streaming responses?
