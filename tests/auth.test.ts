import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractToken,
  validateAuthConfig,
  enforceAuth,
  type AuthVerifier,
} from "../src/server/auth";
import type { CommandSchema, MorlockAuth } from "../src/shared/types";

// ── Token extraction ──────────────────────────────────────────────────────────

test("extractToken: Bearer scheme", () => {
  const tok = extractToken({ authorization: "Bearer abc.def.ghi" });
  assert.deepEqual(tok, { type: "bearer", token: "abc.def.ghi" });
});

test("extractToken: case-insensitive scheme", () => {
  const tok = extractToken({ authorization: "bEaReR secret" });
  assert.deepEqual(tok, { type: "bearer", token: "secret" });
});

test("extractToken: X-Api-Key header", () => {
  const tok = extractToken({ "x-api-key": "sk_live_abc" });
  assert.deepEqual(tok, { type: "apikey", token: "sk_live_abc" });
});

test("extractToken: X-Morlock-Api-Key alias", () => {
  const tok = extractToken({ "x-morlock-api-key": "sk-morlock-xyz" });
  assert.deepEqual(tok, { type: "apikey", token: "sk-morlock-xyz" });
});

test("extractToken: no credential → null", () => {
  assert.equal(extractToken({}), null);
});

test("extractToken: malformed Authorization (no token) → null", () => {
  assert.equal(extractToken({ authorization: "Bearer" }), null);
});

test("extractToken: unknown scheme → null", () => {
  assert.equal(extractToken({ authorization: "Basic dXNlcjpwYXNz" }), null);
});

// ── Startup config validation ─────────────────────────────────────────────────

test("validateAuthConfig: type='none' requires no verifier", () => {
  // Should not throw.
  validateAuthConfig({ type: "none" }, {});
});

test("validateAuthConfig: type='bearer' without verifier throws", () => {
  assert.throws(
    () => validateAuthConfig({ type: "bearer" }, {}),
    /CONFIGURATION ERROR/
  );
});

test("validateAuthConfig: type='apikey' with verifier is fine", () => {
  validateAuthConfig(
    { type: "apikey" },
    { verifier: async () => ({ ok: true, principal: "u" }) }
  );
});

// ── Runtime enforcement ───────────────────────────────────────────────────────

const noAuth: MorlockAuth = { type: "none" };
const bearerAuth: MorlockAuth = { type: "bearer" };
const bearerPublicReads: MorlockAuth = { type: "bearer", allowPublicRead: true };

const writeCmd: CommandSchema = { description: "", safety: "write" };
const readCmd: CommandSchema = { description: "", safety: "read" };

test("enforceAuth: type='none' always passes", async () => {
  const r = await enforceAuth({}, "anyCmd", writeCmd, noAuth, {});
  assert.equal(r.ok, true);
});

test("enforceAuth: allowPublicRead bypasses on read commands", async () => {
  const r = await enforceAuth({}, "search", readCmd, bearerPublicReads, {});
  assert.equal(r.ok, true);
});

test("enforceAuth: allowPublicRead does NOT bypass writes", async () => {
  const r = await enforceAuth({}, "save", writeCmd, bearerPublicReads, {
    verifier: async () => ({ ok: false, reason: "no token" }),
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 401);
});

test("enforceAuth: missing credential → 401", async () => {
  const verifier: AuthVerifier = async () => ({ ok: true });
  const r = await enforceAuth({}, "cmd", writeCmd, bearerAuth, { verifier });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 401);
    assert.match(r.reason, /Bearer|X-Api-Key/);
  }
});

test("enforceAuth: verifier rejects → 403", async () => {
  const verifier: AuthVerifier = async () => ({ ok: false, reason: "invalid token" });
  const r = await enforceAuth(
    { authorization: "Bearer bad" },
    "cmd",
    writeCmd,
    bearerAuth,
    { verifier }
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.equal(r.reason, "invalid token");
  }
});

test("enforceAuth: verifier accepts → ok with principal", async () => {
  const verifier: AuthVerifier = async ({ token }) => ({
    ok: true,
    principal: `user-for-${token}`,
  });
  const r = await enforceAuth(
    { authorization: "Bearer t1" },
    "cmd",
    writeCmd,
    bearerAuth,
    { verifier }
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.principal, "user-for-t1");
});

test("enforceAuth: passes command scopes to verifier", async () => {
  let seenScopes: string[] | undefined;
  const verifier: AuthVerifier = async ({ scopes }) => {
    seenScopes = scopes;
    return { ok: true };
  };
  const cmd: CommandSchema = { description: "", safety: "write", requiredScopes: ["write:stuff"] };
  await enforceAuth(
    { authorization: "Bearer t" },
    "cmd",
    cmd,
    bearerAuth,
    { verifier }
  );
  assert.deepEqual(seenScopes, ["write:stuff"]);
});
