# Security Policy

## Supported versions

Only the latest minor release receives security fixes. We follow semver within `0.x`, so a patch bump (`0.2.1` → `0.2.2`) is our vehicle for security fixes within the current minor.

| Version | Supported |
|---|---|
| `0.2.x` | ✅ |
| `0.1.x` | ❌ — please upgrade |

## Reporting a vulnerability

Please do NOT file public issues for security reports.

Email **werner@mnm.dev** with:

- A description of the issue and its impact
- Steps to reproduce (curl commands, minimal config, a gist is fine)
- Your preferred handle for credit (or `anonymous`)

We aim to:

- Acknowledge receipt within 2 business days
- Share a preliminary assessment within 5 business days
- Ship a fix and coordinated disclosure within 30 days for High/Critical issues

If you don't hear back in 5 business days, re-send and assume the first email was missed.

## Scope

In scope:

- `@morlock/core` (this repo) — the library itself
- The wire protocol defined in `spec/v0.2.md`
- The CLI at `packages/cli/`

Out of scope:

- Third-party apps that embed `@morlock/core`. Report those directly to the app owner.
- Social engineering of maintainers, brute-force DoS against `morlocks.dev`, or anything that would violate computer-misuse laws.

## Known non-issues (by design)

These are often reported as vulnerabilities but are intentional:

- **In-memory default stores are per-process.** Deployers running multi-instance must plug in a shared store (Redis/KV). Documented in the README's Rate Limiting and Idempotency sections.
- **`corsOrigins: "*"` is configurable.** It's only unsafe when combined with write/unsafe commands or auth; we warn at startup but do not block, because some fully-public read-only manifests legitimately want `"*"`.
- **`trustedProxyCount` defaults to 0.** The library refuses to trust `X-Forwarded-For` unless you tell it how many proxies are in front. Misconfiguration here is a deployer choice, not a library bug.

## Previous advisories

See [SECURITY-PATCHES.md](./SECURITY-PATCHES.md) for the version-scoped record of security-relevant fixes.
