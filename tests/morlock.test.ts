// Integration tests exercising the full security pipeline via Morlock.execute().
// No HTTP layer — we craft MorlockContext by hand. This mirrors what each
// adapter does after parsing the request.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMorlock } from "../src/server/index";
import { InMemoryRateLimiterStore } from "../src/server/rate-limit";
import { InMemoryIdempotencyStore } from "../src/server/idempotency";
import type { MorlockContext } from "../src/server/index";

function ctx(over: Partial<MorlockContext> = {}): MorlockContext {
  return {
    headers: {},
    ip: "1.2.3.4",
    clientIp: "1.2.3.4",
    ...over,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

test("read command: no auth, no idempotency, executes handler", async () => {
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    commands: {
      echo: {
        description: "echo",
        safety: "read",
        handler: ({ msg }) => ({ msg }),
      },
    },
  });
  const res = await m.execute({ command: "echo", args: { msg: "hi" } }, ctx());
  assert.equal(res.ok, true);
  assert.deepEqual(res.result, { msg: "hi" });
  assert.ok(res.meta?.executionMs !== undefined);
});

test("baseUrl trailing slash is normalized in manifest", () => {
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example/",
    rateLimit: false,
    commands: { x: { description: "", safety: "read", handler: () => null } },
  });
  const manifest = m.manifest();
  assert.equal(manifest.baseUrl, "https://t.example");
  assert.equal(manifest.endpoint, "https://t.example/.well-known/morlock");
});

// ── Unknown command ───────────────────────────────────────────────────────────

test("unknown command returns generic 404 — no enumeration", async () => {
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    commands: {
      secretOne: { description: "", safety: "read", handler: () => null },
      secretTwo: { description: "", safety: "read", handler: () => null },
    },
  });
  const res = await m.execute({ command: "nope" }, ctx());
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "UNKNOWN_COMMAND");
  // The error message MUST NOT leak the real command names.
  assert.doesNotMatch(res.error!.message, /secretOne|secretTwo/);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

test("startup: declared auth without verifier throws", () => {
  assert.throws(
    () =>
      createMorlock({
        name: "T",
        baseUrl: "https://t.example",
        auth: { type: "bearer" },
        commands: { x: { description: "", safety: "read", handler: () => null } },
      }),
    /CONFIGURATION ERROR/
  );
});

test("missing auth on write command → 401 + onAuthFailure called", async () => {
  let captured: unknown = null;
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    auth: { type: "bearer" },
    verifier: async () => ({ ok: true }),
    rateLimit: false,
    onAuthFailure: (info) => { captured = info; },
    commands: {
      write: { description: "", safety: "write", handler: () => "ok" },
    },
  });
  const res = await m.execute({ command: "write" }, ctx({ headers: {} }));
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "AUTH_REQUIRED");
  assert.ok(captured && (captured as { status: number }).status === 401);
});

test("verifier rejects token → 403 + onAuthFailure called", async () => {
  let captured: unknown = null;
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    auth: { type: "bearer" },
    verifier: async () => ({ ok: false, reason: "bad" }),
    rateLimit: false,
    onAuthFailure: (info) => { captured = info; },
    commands: {
      write: { description: "", safety: "write", handler: () => "ok" },
    },
  });
  const res = await m.execute(
    { command: "write" },
    ctx({ headers: { authorization: "Bearer x" } })
  );
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "FORBIDDEN");
  assert.ok(captured && (captured as { status: number }).status === 403);
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

test("rate limit: over-quota returns 429 + onRateLimit called, with rate-limit meta", async () => {
  const store = new InMemoryRateLimiterStore();
  let hits = 0;
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: { maxRequests: 2, windowMs: 60_000, store },
    onRateLimit: () => { hits++; },
    commands: { x: { description: "", safety: "read", handler: () => "ok" } },
  });
  await m.execute({ command: "x" }, ctx());
  await m.execute({ command: "x" }, ctx());
  const res = await m.execute({ command: "x" }, ctx());

  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "RATE_LIMITED");
  assert.equal(hits, 1);
  assert.equal(res.meta?.rateLimitRemaining, 0);
  assert.ok(typeof res.meta?.rateLimitReset === "number");
  store.destroy();
});

test("successful response carries rate-limit meta too", async () => {
  const store = new InMemoryRateLimiterStore();
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: { maxRequests: 10, windowMs: 60_000, store },
    commands: { x: { description: "", safety: "read", handler: () => "ok" } },
  });
  const res = await m.execute({ command: "x" }, ctx());
  assert.equal(res.ok, true);
  assert.equal(res.meta?.rateLimitRemaining, 9);
  store.destroy();
});

// ── Idempotency ───────────────────────────────────────────────────────────────

test("write command without idempotency key → 409", async () => {
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    commands: { save: { description: "", safety: "write", handler: () => "done" } },
  });
  const res = await m.execute({ command: "save" }, ctx());
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "IDEMPOTENCY_KEY_REQUIRED");
});

test("write command with malformed idempotency key → 422 INVALID_PARAMS", async () => {
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    commands: { save: { description: "", safety: "write", handler: () => "done" } },
  });
  const res = await m.execute(
    { command: "save" },
    ctx({ headers: { "x-morlock-idempotency-key": "has space" } })
  );
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "INVALID_PARAMS");
});

test("duplicate idempotency key replays cached response (success)", async () => {
  const store = new InMemoryIdempotencyStore();
  let handlerCalls = 0;
  let replayCbHits = 0;
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    idempotency: { store },
    onIdempotencyReplay: () => { replayCbHits++; },
    commands: {
      save: {
        description: "",
        safety: "write",
        handler: () => { handlerCalls++; return { n: handlerCalls }; },
      },
    },
  });
  const key = { "x-morlock-idempotency-key": "op-1" };
  const first = await m.execute({ command: "save" }, ctx({ headers: key }));
  const second = await m.execute({ command: "save" }, ctx({ headers: key }));

  assert.equal(handlerCalls, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(second.result, { n: 1 });
  assert.equal(second.meta?.idempotentReplayed, true);
  assert.equal(replayCbHits, 1);
  store.destroy();
});

test("duplicate idempotency key replays cached FAILURE intact", async () => {
  // This is the big v0.2.1 correctness fix — retries of a failed handler
  // must not re-run the handler.
  const store = new InMemoryIdempotencyStore();
  let handlerCalls = 0;
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    idempotency: { store },
    commands: {
      save: {
        description: "",
        safety: "write",
        handler: () => {
          handlerCalls++;
          throw new Error("first-call-side-effect-already-happened");
        },
      },
    },
  });
  const key = { "x-morlock-idempotency-key": "op-fail" };
  const first = await m.execute({ command: "save" }, ctx({ headers: key }));
  const second = await m.execute({ command: "save" }, ctx({ headers: key }));

  assert.equal(handlerCalls, 1);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(second.error?.message, "first-call-side-effect-already-happened");
  assert.equal(second.meta?.idempotentReplayed, true);
  store.destroy();
});

// ── Param validation ─────────────────────────────────────────────────────────

test("invalid params → 422 INVALID_PARAMS", async () => {
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    commands: {
      search: {
        description: "",
        safety: "read",
        params: { q: { type: "string", required: true, minLength: 2 } },
        handler: () => [],
      },
    },
  });
  const missing = await m.execute({ command: "search" }, ctx());
  assert.equal(missing.error?.code, "INVALID_PARAMS");

  const tooShort = await m.execute({ command: "search", args: { q: "a" } }, ctx());
  assert.equal(tooShort.error?.code, "INVALID_PARAMS");
});

// ── Handler throws ────────────────────────────────────────────────────────────

test("handler throws → 500 COMMAND_FAILED, onError called, no stack leaked", async () => {
  let captured: unknown = null;
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    onError: (e) => { captured = e; },
    commands: {
      boom: {
        description: "",
        safety: "read",
        handler: () => { throw new Error("oops detail"); },
      },
    },
  });
  const res = await m.execute({ command: "boom" }, ctx());
  assert.equal(res.ok, false);
  assert.equal(res.error?.code, "COMMAND_FAILED");
  // Message comes from Error.message — no stack, no extra frames.
  assert.equal(res.error?.message, "oops detail");
  assert.ok(captured instanceof Error);
});

test("handler throws a non-Error (e.g. string) → generic fallback message", async () => {
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    commands: {
      boom: {
        description: "",
        safety: "read",
        handler: () => { throw "a bare string"; },
      },
    },
  });
  const res = await m.execute({ command: "boom" }, ctx());
  assert.equal(res.ok, false);
  // Must not stringify the thrown value directly — message is generic.
  assert.doesNotMatch(res.error!.message, /a bare string/);
});

// ── Pipeline ordering ────────────────────────────────────────────────────────

test("pipeline order: rate limit runs BEFORE auth", async () => {
  // A request that would fail auth should still fail with 429 if over limit —
  // we don't want to leak "your token is bad" to rate-limited attackers.
  const store = new InMemoryRateLimiterStore();
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: { maxRequests: 0, windowMs: 60_000, store },
    auth: { type: "bearer" },
    verifier: async () => ({ ok: false, reason: "bad" }),
    commands: { x: { description: "", safety: "write", handler: () => "ok" } },
  });
  const res = await m.execute({ command: "x" }, ctx());
  assert.equal(res.error?.code, "RATE_LIMITED");
  store.destroy();
});

test("pipeline order: unknown command runs after rate limit, before auth", async () => {
  // This prevents unauthenticated probers from distinguishing "command exists
  // but you're not authed" from "command doesn't exist".
  const m = createMorlock({
    name: "T",
    baseUrl: "https://t.example",
    rateLimit: false,
    auth: { type: "bearer" },
    verifier: async () => ({ ok: true }),
    commands: { known: { description: "", safety: "write", handler: () => "ok" } },
  });
  const res = await m.execute({ command: "unknown" }, ctx());
  assert.equal(res.error?.code, "UNKNOWN_COMMAND");
});
