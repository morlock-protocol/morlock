# @morlock/cli

Command-line tools for the [Morlock protocol](https://github.com/morlock-protocol/morlock) — the open standard for making websites natively discoverable by AI agents.

## Install

```bash
# One-off
npx @morlock/cli quickstart

# Global install
npm install -g @morlock/cli
morlock quickstart
```

Requires Node 18 or later. Zero runtime dependencies.

## Commands

### `morlock quickstart`

Interactive walkthrough for site owners. Explains the Morlock protocol, shows the middleware setup for Express / Next.js / Workers / Bun / Deno, helps you shape your first command, and tells you how to verify everything end-to-end.

No changes are made to your filesystem, npm install state, or running servers — it's a teaching tool. Copy the snippets into your own project.

### `morlock ping <domain>`

Fetches a site's `/.well-known/morlock` manifest and tells you whether it looks healthy.

```bash
$ morlock ping acme.com

  ▓▓ Morlock  ping

  ▓▓▓▓  IT'S ALIVE.

  ✓  Acme Store is on the agentic web.
  ✓  Protocol v0.2
  ✓  3 commands: search, getProduct, addToCart
```

Follows up to 3 HTTP redirects. Times out after 8 seconds. Prints the manifest URL it checked even on failure — useful for debugging misrouted `/.well-known/` paths.

### `morlock help`

Lists commands.

## Related

- **[@morlock/core](https://www.npmjs.com/package/@morlock/core)** — the library you install in your site to serve a Morlock manifest.
- **[Protocol spec](https://github.com/morlock-protocol/morlock/blob/main/spec/v0.2.md)** — the wire format.

## License

MIT
