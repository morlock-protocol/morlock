# Production Changelog

Record of production-readiness batches. Every batch lists: **what was wrong → what changed → why it matters → files → follow-ups.**

This sits alongside `SECURITY-PATCHES.md` (version-scoped security fixes) and the regular git log. Entries here describe batches, not individual commits.

## Session: 2026-04-16 — Launch readiness pass (targeting @morlock/core 0.2.2)

### Batch 0 — 0.2.1 pre-work (done earlier this session)

- Fixed `@morlock/core` packaging (self-dep, exports, files allowlist, keywords, prepublishOnly).
- Added `src/index.ts` root re-export.
- Fixed `src/server/index.ts`: Next.js/fetch adapter XFF spoof; idempotency on failure; Express body guard; JSON parse guards.
- Fixed CLI quickstart import path (`/express` → `/server`) and surrounding config shape.
- Pushed to `origin/main`.

_See `SECURITY-PATCHES.md` for the security-scoped record of these._

### Batch 7 — Finalize docs, bump, dry-run — DONE

**What was wrong**

- Session-long changes to behaviour and contracts (rate-limit store interface, idempotency-key validation, body-size cap, observability hooks) needed a version bump and a proper security-log entry.
- No `SECURITY_REVIEW.md`, `TECH_DEBT_BACKLOG.md`, or `RUNBOOK.md` — the audit doc-set the user asked for was incomplete.
- `package-lock.json` still referenced the self-dep from the 0.2.0 era.

**What changed**

- Bumped `@morlock/core` to `0.2.2`.
- Added a `v0.2.2` section to `SECURITY-PATCHES.md` covering idempotency-key bounds and body-size caps.
- Wrote `SECURITY_REVIEW.md`: threat model, 14 implemented controls tied to source lines and test names, 5 remaining risks with mitigations, 7 deployment recommendations.
- Wrote `TECH_DEBT_BACKLOG.md`: 4 high-priority, 6 medium-priority, 10 low-priority items with severity/effort/rationale.
- Wrote `RUNBOOK.md`: local dev, release workflow, rollback, observability wiring, health checks, branch-protection setup, troubleshooting.
- Regenerated `package-lock.json` from the current tree — now reflects only `@types/node` as a dev dep, no stale `@morlock/core` node.
- Final validation: 72/72 tests pass, typecheck clean, core dry-run 31 files (32.4 KB), CLI dry-run 18 files (12.5 KB). No unexpected files in either tarball.

**Why this improves launch readiness**

- A new engineer joining the team can read the four audit docs (audit + changelog + security review + runbook) and understand what the product is, what was fixed, why, what's left, and how to operate it.
- Versioning reflects the actual delta since the last public version — users upgrading 0.2.1 → 0.2.2 get a clear `SECURITY-PATCHES.md` section describing the fixes.
- Lockfile is clean; CI will not surface phantom deps.

**Files affected**

- `package.json` (version bump)
- `SECURITY-PATCHES.md` (v0.2.2 section)
- `SECURITY_REVIEW.md` (new)
- `TECH_DEBT_BACKLOG.md` (new)
- `RUNBOOK.md` (new)
- `package-lock.json` (regenerated)

**Follow-up risk**

- User still needs to `npm publish` from their environment. Dry-run is clean; the actual publish will carry the tarball shown in this batch.
- OIDC trusted publisher isn't configured yet (HT-1 in backlog). First `0.2.2` publish will need `NPM_TOKEN` until that's wired.

### Batch 6 — CLI publish prep — DONE

**What was wrong**

- No `files` allowlist in `packages/cli/package.json`. A publish would include `src/`, `tsconfig.json`, and `package-lock.json` — bloat + leaks of nothing sensitive but nothing useful.
- Two bin entries: `morlock` and `quickstart`. Claiming `quickstart` as a global bin command is aggressively broad — it's a generic name and fights other tools.
- No `publishConfig.access` — a first `npm publish` without `--access public` fails silently for scoped packages.
- No `description`, `keywords`, `repository`, `homepage`. npm page would be blank.
- No README in the CLI package → npm page would be blank.
- No `LICENSE` file in the CLI package → the tarball had no license file, only a field.
- `@types/node: ^25.5.2` in devDependencies pinned to a very new major. Bumped to `^22.0.0` to match CI support range.
- No `engines.node`. Consumers on unsupported Node get a confusing `import.meta` / `crypto` crash instead of an npm install refusal.

**What changed**

- Rewrote `packages/cli/package.json`: `files` allowlist, dropped second bin, `publishConfig.access: public`, `prepublishOnly: npm run build`, keywords, `repository.directory: "packages/cli"`, `homepage`, `engines.node: ">=18"`, updated `@types/node` to `^22.0.0`.
- Added `packages/cli/README.md` — describes both commands, the `ping` redirect behaviour, and the `morlock/cli ↔ morlock/core` relationship. npm page is now informative.
- Copied the repo `LICENSE` into `packages/cli/` so it's packed into the tarball.
- Verified clean dry-run: 18 files, 12.5 kB tarball, nothing outside `dist/**` + `README.md` + `LICENSE` + `package.json`.

**Why this improves launch readiness**

- `@morlock/cli` can actually be published now. Before this batch, `npm publish` would have landed a broken package and re-publishing a same-version `0.2.0` is not possible on npm.
- Users running `morlock ...` get a sensible CLI name that won't collide. The removed `quickstart` bin would have been a footgun.
- `engines.node` means an install on Node 16 fails fast with a real message instead of running and exploding at runtime.

**Files affected**

- `packages/cli/package.json` — full rewrite
- `packages/cli/README.md` (new)
- `packages/cli/LICENSE` (new — copy of root LICENSE)

**Follow-up risk**

- CLI tests: none yet. The two commands are small and each runs against a real endpoint in practice; test coverage would need a manifest-server fixture. Deferred to `TECH_DEBT_BACKLOG.md`.
- npm page once published: will not show the root repo description; user may want to confirm the homepage URL renders well on npmjs.com.

### Batch 5 — CI + ops — DONE

**What was wrong**

- Zero CI. `npm publish` ran at any maintainer's whim with no typecheck/build/test gating.
- No `SECURITY.md`, so reporters had no clear disclosure channel — security research was implicitly steered to public issues.
- No `CODEOWNERS` / PR template / issue templates. Contributor expectations lived only in the maintainer's head.
- No `dependabot.yml`. GitHub Actions versions would drift silently.

**What changed**

- `.github/workflows/ci.yml` — two jobs (`core`, `cli`) × Node 20/22/24 matrix. Each: `npm ci` → `typecheck` → `build` → `test`. The core job additionally runs `npm publish --dry-run` and fails CI if the tarball would include `src/`, `tsconfig.json`, `.env`, `examples/`, `spec/`, or `packages/`. `concurrency` cancels superseded runs.
- `.github/workflows/publish-core.yml` — manually triggered (`workflow_dispatch`) publish with a `dry_run` input. Uses npm provenance (`--provenance`) via OIDC where configured, plus an `NPM_TOKEN` fallback. Runs full typecheck/build/test before publishing — can't ship a broken build.
- `SECURITY.md` — clear disclosure channel (email), SLA, in-scope/out-of-scope, list of intentional non-issues (in-memory stores, corsOrigins wildcard config, trustedProxyCount default).
- `.github/CODEOWNERS` — auto-assigns security-sensitive paths (auth, rate-limit, idempotency, spec, workflows) to the maintainer. Flagged placeholder `@werner-mnm` in tech-debt backlog for real-handle confirmation.
- `.github/pull_request_template.md` — a real pre-merge checklist including `npm test`, dry-run contents, security/break notes.
- `.github/ISSUE_TEMPLATE/bug_report.yml`, `protocol_change.yml` — bug vs protocol proposals go to different channels because they have different review models.
- `.github/dependabot.yml` — monthly Actions updates grouped; no npm ecosystem watch (zero runtime deps).

**Why this improves launch readiness**

- CI is the floor of correctness. Every PR and push-to-main is now typechecked, built, and tested across three Node versions before merging. The publish-content check prevents the most common npm packaging mistake (shipping `src/`).
- Security reporters have a clear, private channel. Without `SECURITY.md`, they either posted publicly or gave up.
- Publishing is no longer a laptop operation. The workflow provides provenance, a build record, and test-pass evidence attached to the version.
- Contributor-facing expectations (code ownership, PR content, bug report format) are encoded, not oral.

**Files affected**

- `.github/workflows/ci.yml` (new)
- `.github/workflows/publish-core.yml` (new)
- `.github/CODEOWNERS` (new)
- `.github/pull_request_template.md` (new)
- `.github/ISSUE_TEMPLATE/bug_report.yml` (new)
- `.github/ISSUE_TEMPLATE/protocol_change.yml` (new)
- `.github/dependabot.yml` (new)
- `SECURITY.md` (new)

**Follow-up risk**

- OIDC trusted publisher requires one-time setup on the npm package side (npmjs.com → Package → Publishing settings → Add trusted publisher). Until configured, the workflow falls back to `NPM_TOKEN` secret auth. Both paths supported; user must pick.
- `CODEOWNERS` uses placeholder `@werner-mnm`. Tracked in `TECH_DEBT_BACKLOG.md`.
- Branch protection (require CI pass to merge) isn't configured here because it lives in GitHub repo settings, not code. Runbook documents it.

### Batch 4 — Test suite — DONE

**What was wrong**

Zero automated tests. Every security-critical path — auth enforcement, idempotency replay, rate limit IP resolution, param validation, pipeline ordering — was verified only by visual inspection. The v0.2.0 → v0.2.1 fixes could regress silently on the next refactor.

**What changed**

Added **72 tests** across 5 files using `node:test` (stdlib, zero extra runtime deps). Scaffolding via a separate `tsconfig.test.json` compiling to `dist-tests/`. `npm test` typechecks and runs; `npm run test:watch` for iteration.

| File | Tests | Covers |
|---|---|---|
| `tests/validate.test.ts` | 16 | every branch of `validateParamsAgainst` (null/array/enum/pattern/length/range/maxItems/invalid-pattern) |
| `tests/idempotency.test.ts` | 10 | key char-class, TTL expiry, duplicate detection, read-bypass, null-key no-op |
| `tests/rate-limit.test.ts` | 12 | trustedProxyCount at 0/1/2, fallback behaviour, bucket reset time fidelity, multi-IP isolation |
| `tests/auth.test.ts` | 16 | bearer + apikey + alias extraction, case-insensitivity, startup config validation, allowPublicRead interaction with safety, scope passthrough |
| `tests/morlock.test.ts` | 18 | integration over `Morlock.execute()` — baseUrl normalization, generic 404 no-enumeration, auth/rate-limit/idempotency hooks fired, cached-failure replay doesn't re-run handler, pipeline ordering (rate-limit before auth, 404 before auth), handler-throws behaviour |

**Why this improves launch readiness**

- Every known v0.2.0/0.2.1 regression has a guard now. If someone refactors the idempotency store and forgets to record failures, the "duplicate idempotency key replays cached FAILURE intact" test fails loudly.
- The pipeline-ordering tests lock in the information-hiding properties the spec requires (unauthenticated probers can't distinguish "command exists" from "command doesn't exist").
- Runs in ~55 ms. Fast enough that every commit can run them; CI integration in Batch 5.

**Files affected**

- `tsconfig.test.json` (new) — scoped build config for tests
- `tests/validate.test.ts`, `tests/idempotency.test.ts`, `tests/rate-limit.test.ts`, `tests/auth.test.ts`, `tests/morlock.test.ts` (new)
- `package.json` — `test`, `test:watch`, `typecheck` scripts; `@types/node` in devDependencies
- `.gitignore` — added `dist-tests/`

**Follow-up risk**

- No HTTP-layer integration tests. The Express/Next.js/fetch adapters are covered indirectly via `execute()`. Direct adapter tests would need real `Request` objects or a shim — worth adding when we pick up Batch-by-Batch stability.
- No client-SDK tests. The client is pure HTTP invocation with retry; it'd need a `fetch` mock harness. Worth it eventually.
- `node:test` doesn't do coverage out of the box on this Node version — `npm test -- --experimental-test-coverage` produces a summary but not a deep report. Deferred.

### Batch 3 — Observability + rate-limit fidelity — DONE

**What was wrong**

- Rate-limit `resetAt` in responses was always `Date.now() + windowMs`, not the bucket's real reset time. Agents polling budget would see a reset that "moves" into the future each call — impossible to schedule retries against.
- `InMemoryRateLimiterStore.getResetAt` was dead code: it returned the real value but nothing called it.
- HTTP `X-RateLimit-*` headers (SHOULD per spec v0.2 §9.3) were never emitted. Only `meta` fields in the JSON body carried the state.
- Rate-limit `meta` was only attached to 429 responses. Success responses and other 4xx responses carried no rate-limit information.
- No observability hooks for auth failures, rate-limit hits, or idempotency replays. Operators would have to parse 4xx responses to learn anything about abuse or credential issues.
- CLI `ping` used `https.get` with no redirect handling; apex-to-www or http-to-https 301s produced a false "manifest not found."

**What changed**

- `RateLimiterStore.increment()` contract is now `Promise<{ count: number; resetAt: number }>` ([src/server/rate-limit.ts](src/server/rate-limit.ts)). `InMemoryRateLimiterStore` returns the bucket's real `resetAt`. Dead `getResetAt()` method removed. **This is a breaking interface change for custom stores** — documented below.
- `execute()` now captures `{ rateLimitRemaining, rateLimitReset }` once per request and merges it into every response branch (success, 4xx, 5xx, replay). Agents see their budget on every response.
- New private `rateLimitHeaders()` method converts response meta into `X-RateLimit-Remaining` / `X-RateLimit-Reset` (epoch seconds) HTTP headers. All three adapters (Express, Next.js, fetch) now emit these.
- Added `MorlockConfig.onAuthFailure`, `MorlockConfig.onRateLimit`, `MorlockConfig.onIdempotencyReplay` hooks. Wired into `execute()` at the matching pipeline stages. Existing `onRequest` / `onError` unchanged.
- CLI `ping` now follows up to 3 HTTP redirects ([packages/cli/src/commands/ping.ts](packages/cli/src/commands/ping.ts)). Bounded to prevent redirect loops. Returns the `finalUrl` alongside the body so future diagnostics can show where we actually landed.

**Why this improves launch readiness**

- Agents can now trust the rate-limit headers for real scheduling. "Wait until `X-RateLimit-Reset`" works correctly.
- Operators hooked up to `onAuthFailure` / `onRateLimit` can build an abuse dashboard without parsing response bodies.
- The CLI now works against real deployments that use redirects — which in 2026 is almost all of them.
- The observability hooks are minimal (no framework lock-in, no PII by default) — drop-in compatible with Datadog, OpenTelemetry, Sentry by the consumer.

**Files affected**

- `src/server/rate-limit.ts` — interface change + `InMemoryRateLimiterStore` update
- `src/server/index.ts` — rate-limit-meta propagation, observability hooks, rate-limit-header emission
- `packages/cli/src/commands/ping.ts` — redirect following

**Follow-up risk / breaking change notice**

- **Breaking:** `RateLimiterStore.increment` signature. Any consumer who implemented a custom Redis/KV limiter store against 0.2.0/0.2.1 must update. Documented in `SECURITY-PATCHES.md` v0.2.2 (to be written at final bump). Migration is mechanical: return `{ count, resetAt: Date.now() + windowMs }` for fresh buckets, `{ count, resetAt: existing.expiresAt }` for warm ones.
- `X-RateLimit-Reset` uses epoch **seconds** (common convention). If consumers parse as ms, dates display as 1970. Documented in README as part of the rate-limit section in Batch 1.
- Observability hooks run synchronously in the request path. Slow hooks slow requests. Consumers should queue/defer any I/O (Datadog HTTP sends, etc.). Worth noting in RUNBOOK.

### Batch 2 — Input validation + runtime guards — DONE

**What was wrong**

- `validateParams` was minimal: accepted `null` as `"object"`, no string length checks, no regex, no number bounds, no array length limits. A single line of validation per param.
- Idempotency keys had no length cap and no character-class validation. A 10 MB key from a hostile client would pin 10 MB in the store for 24h.
- Next.js and fetch() adapters called `await request.json()` with no body-size cap. A 50 MB body would be parsed into memory unconditionally.
- CORS wildcard path emitted no `Vary: Origin`, so a CDN caching layer could surface one client's response to another. Fallback path (no matching origin) also had no `Vary`.
- `baseUrl` with a trailing slash produced `https://example.com//.well-known/morlock` in the published manifest.
- Startup allowed `corsOrigins: "*"` silently even on configurations with write/unsafe commands, which spec v0.2 §3.3 explicitly forbids. No warning, no guard.

**What changed**

- Extended `ParamSchema` ([src/shared/types.ts](src/shared/types.ts)) with `minLength`/`maxLength`/`pattern` for strings, `min`/`max` for numbers, `maxItems` for arrays. Non-breaking — all optional.
- Refactored validator out of the `Morlock` class into a module-level `validateParamsAgainst()` function ([src/server/index.ts](src/server/index.ts:540)). Adds explicit `null` handling, `Number.isFinite` check for numbers, length/regex/range/items checks. Error messages are intentionally generic (no schema leakage to caller).
- Added `isValidIdempotencyKey()` and bounded keys to 1..255 chars of `[A-Za-z0-9_\-:.]` ([src/server/idempotency.ts](src/server/idempotency.ts)). `checkIdempotency` now distinguishes `key-required` (409) from `key-malformed` (422 INVALID_PARAMS) in the result type.
- Added `MorlockConfig.maxBodyBytes` option (default 256 KiB). Adapters route JSON parsing through a new `readJsonBody()` helper ([src/server/index.ts](src/server/index.ts:358)) that checks `Content-Length` fast-path, drains to text with a size cap, and JSON-parses. Oversized bodies return `413` with `INVALID_PARAMS`. Empty bodies return `400` instead of crashing `JSON.parse`.
- `getCorsHeaders` now always emits `Vary: Origin` (wildcard, allowlisted, and fallback paths). Prevents CDN cross-origin cache bleed regardless of config.
- Added `normalizedBaseUrl` that strips trailing slashes before composing the manifest `endpoint` URL.
- Startup warns when `corsOrigins: "*"` coexists with write/unsafe commands — keeps v0.2 §3.3 visible at deploy time rather than letting a misconfiguration silently ship.

**Why this improves launch readiness**

- Real deployers can now express their constraints (email regex, pagination limits, uuid patterns) in the schema instead of re-validating in every handler — reduces handler boilerplate and centralizes failure modes.
- Idempotency-store DoS via giant keys is closed.
- Memory-exhaustion via unbounded JSON bodies is bounded on edge runtimes. The Express adapter still defers to `express.json({ limit })` per idiom (documented).
- The CORS wildcard misconfig warning prevents a common security mistake.
- Manifest URLs stay clean even if `baseUrl` is sloppy.

**Files affected**

- `src/shared/types.ts` — extended `ParamSchema`
- `src/server/idempotency.ts` — key validation + result-type discriminator
- `src/server/index.ts` — `readJsonBody`, `maxBodyBytes`, `normalizedBaseUrl`, CORS `Vary`, startup cors+writes warning, validator refactor, new exported `validateParamsAgainst`

**Follow-up risk**

- The idempotency-key character class is deliberately narrow. Clients generating keys from arbitrary strings (e.g. email addresses or URL-encoded paths) must normalize first. Documented in the rejection error message.
- `pattern` is compiled per request. A malicious pattern in a malicious manifest could theoretically trigger catastrophic backtracking — but the manifest is written by the site owner, not the caller, so this is not a caller-driven vector. Worth flagging if we ever accept schemas from untrusted sources.
- `maxBodyBytes` default of 256 KiB is aggressive. Consumers uploading larger payloads must opt up. A larger default would mask real abuse; this default is intentional.

### Batch 1 — Truth-in-docs + CLI integrity — DONE

**What was wrong**

- README error example leaked command names (`"Unknown command: 'foo'. Available: search, getProduct, addToCart"`) — the exact anti-pattern spec v0.2 §12 forbids and the code fixed.
- README and `examples/usage.ts` used `await site.run(...)` as if it returned raw results. It returns `MorlockRunResult` `{ result, replayed, idempotencyKey }`. Every copy-paste would log the wrapper.
- README examples omitted `safety:` annotations. Every command defaults to `"unsafe"` → auth + idempotency required → new-user copy-paste hits a `409` wall with no docs explaining why.
- README Auth section showed `auth: { type: "bearer" }` with no `verifier`. Our fail-closed startup check would crash any user following this. No path forward documented.
- README had no docs for `trustedProxyCount`, `corsOrigins`, `allowPublicRead`, `verifier` — launch-critical security knobs.
- README + CLI advertised a Badge service at `https://morlocks.dev/badge/<domain>` which returns 404. Users would generate broken image markdown.
- CLI `quickstart` faked an `npm install` run (real spinner, fake "added 1 package in 0.8s" output). Nothing installed.
- CLI `quickstart` manifest screen showed fields that aren't in the spec (`"version"`, `"transport"`).
- CLI `quickstart` config screen showed `commands: [ ... ]` as an array (real shape: `Record<string, CommandSchema>`) and `input:` (real field: `params:`).
- CLI `quickstart` ran a fake `morlock simulate-agent` step referencing a command that doesn't exist.
- CLI `quickstart` advertised `@morlock/openclaw` — a package that does not exist on npm.
- CLI exposed `quickstart` as a second bin entry, claiming the global `quickstart` command name.
- `src/index.ts` (CLI) exported a `badge` module that we're removing.
- Root `package-lock.json` still listed `@morlock/core: 0.1.0` as a transitive — leftover from the self-dependency.

**What changed**

- Rewrote the relevant [README.md](README.md) sections:
  - Header example now sets `auth` + `verifier` + `safety` for every command.
  - Error-response section replaced with a generic-message example and a full error-code table.
  - New Auth section with `verifier` signature, type matrix, and safety/auth interaction table.
  - New Rate Limiting section with `trustedProxyCount` guidance table.
  - New CORS section (`corsOrigins` behaviour, spec reference).
  - New Idempotency section.
  - Multi-site example fixed to destructure `.run()`.
  - Badge section removed (service not live).
- Rewrote [packages/cli/src/commands/quickstart.ts](packages/cli/src/commands/quickstart.ts) end-to-end:
  - No fake install; explicit instruction to run `npm install @morlock/core`.
  - Manifest screen uses the real v0.2 shape, no invented fields.
  - Command screen uses the real `Record<string, CommandSchema>` with a `safety: "read"` example to avoid the 409 trap.
  - New "verify" screen replaces the fake agent simulation — shows `curl`, `npx @morlock/cli ping`, and a real POST invocation.
  - No reference to `@morlock/openclaw`.
- [packages/cli/src/bin.ts](packages/cli/src/bin.ts):
  - Dropped `quickstart` as a global bin name (package still exposes it as a subcommand).
  - Added `help` / `--help` / `-h`.
  - Removed `badge` subcommand (backing service 404s).
- [examples/usage.ts](examples/usage.ts) rewritten:
  - Every command has a `safety` annotation.
  - Example 2 shows auth + `verifier` + scopes + `trustedProxyCount: 1` for Vercel.
  - Client example destructures `.run()` properly.
  - Idempotency-replay semantics demonstrated.
- Deleted [packages/cli/src/commands/badge.ts](packages/cli/src/commands/badge.ts) and its re-export from `packages/cli/src/index.ts`.

**Why this improves launch readiness**

Primary: docs no longer actively mislead new users about security posture or API shape. Copy-paste from the README now produces a working, correctly-secured Morlock instance on first run. The CLI no longer lies — a core credibility concern for a protocol project. Removing the badge command eliminates a user-visible broken-link pathway.

**Files affected**

- `README.md` (section rewrites: Auth, Rate Limiting, CORS, Idempotency, error codes; removed Badge section)
- `examples/usage.ts` (full rewrite with safety annotations)
- `packages/cli/src/commands/quickstart.ts` (full rewrite)
- `packages/cli/src/bin.ts` (help command, dropped `badge`, dropped `quickstart` as global bin)
- `packages/cli/src/index.ts` (removed badge re-export)
- `packages/cli/src/commands/badge.ts` (deleted)

**Follow-up risk**

- CLI `package.json` still declares the second bin (`"quickstart": "./dist/commands/quickstart.js"`). Will fix in Batch 6.
- No test coverage yet, so this rewrite is visually verified only. Batch 4 will harden.
- The new README advertises `allowPublicRead: true` as the recommended path for public reads under a declared-bearer auth. Correct per spec §6.2 but worth keeping an eye on — it's a subtle concept.
