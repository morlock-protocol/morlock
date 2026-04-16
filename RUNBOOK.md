# Runbook

Operational doc for maintaining `@morlock/core` and `@morlock/cli`. Covers local dev, release, and the "something's on fire" paths.

## Repository layout

```
morlock/
├─ src/                    # @morlock/core — published to npm
│  ├─ server/              # Morlock class, adapters, security pipeline
│  ├─ client/              # agent-side SDK
│  ├─ shared/              # wire-format types
│  └─ index.ts             # root re-export (server, client, shared types)
├─ tests/                  # node:test — 72 tests, ~55ms runtime
├─ packages/cli/           # @morlock/cli — separate package, unpublished
├─ spec/                   # protocol spec (v0.1 and v0.2)
├─ examples/usage.ts       # illustrative code, not built or shipped
└─ .github/workflows/      # CI + manual publish
```

## Running locally

```bash
npm install              # dev deps (only @types/node)
npm run build            # tsc → dist/
npm test                 # tsc -p tsconfig.test.json → dist-tests/, then node --test
npm run typecheck        # tsc --noEmit, no artifacts
npm run dev              # tsc --watch for live build
```

For the CLI:

```bash
cd packages/cli
npm install              # only @types/node
npm run build            # tsc → dist/
node dist/bin.js help    # smoke test
node dist/bin.js ping morlocks.dev   # integration smoke test
```

## Environment variables

**None required.** `@morlock/core` has zero runtime dependencies and no env inputs. Consumers supply everything via the `createMorlock(config)` call.

CI secrets (in repo settings, not code):

- `NPM_TOKEN` — fallback publish token if OIDC trusted publisher isn't configured. Should be an npm automation token scoped to publish `@morlock/core` only.

## Release workflow

### Normal release (patch or minor)

1. Create a feature branch from `main`.
2. Make changes. Ensure:
   - `npm test` passes (`npm run typecheck` if you only want a quick check).
   - Any docs affected by your change are updated in the same PR.
3. Bump `package.json` version. Semver:
   - Bug fix / security fix → patch (`0.2.x`)
   - New non-breaking feature → minor (`0.x.0`)
   - Breaking change → major (`x.0.0`) — reserved; we're pre-1.0 so minors can carry breaking changes if loudly flagged.
4. Update `SECURITY-PATCHES.md` with a new section if this release includes security-relevant fixes.
5. Open a PR. CI must pass.
6. Merge to `main`.
7. Trigger `publish-core.yml` via GitHub Actions UI:
   - Leave `dry_run` unchecked for a real publish.
   - Check `dry_run` to validate the build artifact before committing to a version.
8. Confirm the version is live: `npm info @morlock/core version`.
9. Create a GitHub release tagged `v0.2.x` pointing at the merge commit.

### CLI release

Same workflow but `@morlock/cli` has no workflow wired yet — `npm publish --access public` from `packages/cli/` manually. Workflow addition is in `TECH_DEBT_BACKLOG.md`.

### Rollback

npm has a 72-hour unpublish window, but only for versions that have no dependents and where no replacement can be published to the same version. In practice: **don't unpublish.** Publish a new patch that reverts the problematic change.

Emergency rollback sequence:

1. Revert the bad commit on `main` via a revert PR.
2. Bump the patch version (e.g. 0.2.2 bad → 0.2.3 revert).
3. Publish 0.2.3.
4. npm auto-promotes the highest semver as `latest` dist-tag; 0.2.3 takes over.

Deprecate the bad version:

```bash
npm deprecate @morlock/core@0.2.2 "Contains regression in X; use 0.2.3 or later."
```

## Common tasks

### Add a new command validator field

1. Add the field to `ParamSchema` in [src/shared/types.ts](src/shared/types.ts).
2. Add the check in `validateParamsAgainst` in [src/server/index.ts](src/server/index.ts).
3. Add a test in [tests/validate.test.ts](tests/validate.test.ts).
4. Document in `README.md` under the command definition example.

### Add a new framework adapter

1. Add a method on the `Morlock` class in [src/server/index.ts](src/server/index.ts) (e.g. `hono()`).
2. Reuse `readJsonBody()`, `getCorsHeaders()`, `rateLimitHeaders()`.
3. Add an integration test in `tests/morlock.test.ts` that covers the adapter's request/response flow.
4. Update the README's Framework Support table.

### Regenerate the lockfile

```bash
rm package-lock.json
npm install
git add package-lock.json && git commit -m "chore: refresh lockfile"
```

Only do this when intentional — otherwise it churns the diff.

## Observability hooks

All fire synchronously in the request path. Defer I/O (Datadog / Sentry HTTP sends) to a queue or async channel.

| Hook | Fires when |
|---|---|
| `onRequest` | Every incoming request, before rate limit |
| `onError` | A command handler throws |
| `onAuthFailure` | Credentials missing (401) or rejected (403) |
| `onRateLimit` | Per-IP window exceeded (429) |
| `onIdempotencyReplay` | Duplicate key returns cached response |

Suggested pipeline:

```ts
onRequest: (req, ctx) => metrics.incr("morlock.request", { cmd: req.command }),
onError:   (err, req) => sentry.captureException(err, { tags: { cmd: req.command } }),
onAuthFailure: (info) => metrics.incr("morlock.auth_failure", info),
onRateLimit:   (info) => metrics.incr("morlock.rate_limit",   info),
```

## Health checking in production

```bash
# Basic manifest check
curl https://your-app.com/.well-known/morlock

# CLI probe
npx @morlock/cli ping your-app.com

# Verify a read command works
curl -X POST https://your-app.com/.well-known/morlock \
  -H "Content-Type: application/json" \
  -d '{"command":"search","args":{"q":"hello"}}'
```

## Branch protection (to configure in GitHub)

Not in code. Configure on `main`:

- Require CI (`ci` workflow) to pass
- Require at least 1 approving review
- Require conversation resolution before merging
- Dismiss stale approvals on new commits
- No direct pushes (force all changes through PR)

## Troubleshooting

### "Startup: CONFIGURATION ERROR: auth.type is 'bearer' but no auth verifier was provided"

Declaring auth without supplying a `verifier` function is fail-closed by design. Add a verifier, or set `auth.type: "none"`.

### "409 IDEMPOTENCY_KEY_REQUIRED" on a new-to-Morlock user's first request

Commands default to `safety: "unsafe"`. An unsafe command requires an idempotency key. Either:
- Add `safety: "read"` if the command is actually read-only, OR
- Send `X-Morlock-Idempotency-Key: <uuid>` on every request (the `@morlock/core/client` SDK does this automatically).

### Rate-limit bucket seems off

- Running multiple replicas with the default in-memory store? Plug in a shared Redis/KV store.
- Set `trustedProxyCount` to match your hop count. Default `0` means everyone behind a reverse proxy keys to the proxy's IP — effectively one shared bucket.

### `npm publish` fails with "You cannot publish over previously published versions"

Bump the version. npm is append-only.

## Contacts

- **Maintainer:** werner@mnm.dev
- **Security reports:** werner@mnm.dev (see [SECURITY.md](./SECURITY.md))
- **Repo:** https://github.com/morlock-protocol/morlock
