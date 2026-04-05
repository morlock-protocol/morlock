# Contributing to Morlock

Thanks for your interest in contributing. Morlock is an open protocol — the spec and library are built in the open and PRs are welcome.

## Ways to contribute

- **Protocol feedback** — open an issue against `spec/v0.1.md` with proposed changes
- **Framework adapters** — new adapters for Fastify, Hono, Django, Laravel, etc.
- **Bug fixes** — anything in `src/` with a failing test case
- **Examples** — real-world usage examples in `examples/`
- **Documentation** — improvements to the README or spec

## Process

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Make your changes
4. Open a PR with a clear description of what and why

## Protocol changes

Changes to `spec/v0.1.md` that affect wire format or behaviour require an issue first so the community can discuss before implementation.

## Code style

TypeScript, strict mode, no `any`. Keep it clean.
