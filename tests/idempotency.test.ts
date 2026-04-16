import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidIdempotencyKey,
  InMemoryIdempotencyStore,
  checkIdempotency,
  recordIdempotency,
} from "../src/server/idempotency";

test("key validation accepts UUIDs, ULIDs, and path-like composites", () => {
  assert.equal(isValidIdempotencyKey("d78e6a50-b53a-4e93-8c8d-6f0cc5a5d8d8"), true);
  assert.equal(isValidIdempotencyKey("01HXYZ1234567890ABCDEFG"), true);
  assert.equal(isValidIdempotencyKey("user:123:order:abc.v1"), true);
  assert.equal(isValidIdempotencyKey("a"), true);
});

test("key validation rejects empty / too-long / bad-char", () => {
  assert.equal(isValidIdempotencyKey(""), false);
  assert.equal(isValidIdempotencyKey("a".repeat(256)), false);
  assert.equal(isValidIdempotencyKey("has space"), false);
  assert.equal(isValidIdempotencyKey("has\nnewline"), false);
  assert.equal(isValidIdempotencyKey("unicode-☃"), false);
  assert.equal(isValidIdempotencyKey("has\"quote"), false);
});

test("read commands never need a key, regardless of header presence", async () => {
  const result = await checkIdempotency({}, "getPost", /* isSafeRead */ true);
  assert.equal(result.status, "proceed");
  assert.equal(result.status === "proceed" && result.key, null);
});

test("write command without key → rejected with code=key-required", async () => {
  const result = await checkIdempotency({}, "addToCart", false);
  assert.equal(result.status, "rejected");
  assert.equal(result.status === "rejected" && result.code, "key-required");
});

test("write command with malformed key → rejected with code=key-malformed", async () => {
  const result = await checkIdempotency(
    { "x-morlock-idempotency-key": "has space" },
    "addToCart",
    false
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.status === "rejected" && result.code, "key-malformed");
});

test("write command with valid new key → proceed with key echoed", async () => {
  const store = new InMemoryIdempotencyStore();
  const result = await checkIdempotency(
    { "x-morlock-idempotency-key": "order-123" },
    "addToCart",
    false,
    { store }
  );
  assert.equal(result.status, "proceed");
  assert.equal(result.status === "proceed" && result.key, "order-123");
  store.destroy();
});

test("duplicate key returns the stored record", async () => {
  const store = new InMemoryIdempotencyStore();
  await recordIdempotency(
    "order-999",
    { status: 200, body: { ok: true, result: "cached" }, completedAt: Date.now() },
    { store }
  );
  const result = await checkIdempotency(
    { "x-morlock-idempotency-key": "order-999" },
    "addToCart",
    false,
    { store }
  );
  assert.equal(result.status, "duplicate");
  if (result.status === "duplicate") {
    assert.deepEqual(result.record.body, { ok: true, result: "cached" });
    assert.equal(result.key, "order-999");
  }
  store.destroy();
});

test("requireKeyForWrites=false allows write without key", async () => {
  const result = await checkIdempotency({}, "addToCart", false, { requireKeyForWrites: false });
  assert.equal(result.status, "proceed");
  assert.equal(result.status === "proceed" && result.key, null);
});

test("store TTL: expired records are treated as missing", async () => {
  const store = new InMemoryIdempotencyStore();
  await recordIdempotency(
    "expiring",
    { status: 200, body: { ok: true }, completedAt: Date.now() },
    { store, dedupeWindowMs: 1 }
  );
  // Give the TTL a beat to elapse.
  await new Promise((r) => setTimeout(r, 10));
  const fetched = await store.get("expiring");
  assert.equal(fetched, null);
  store.destroy();
});

test("recordIdempotency is a no-op for null keys", async () => {
  const store = new InMemoryIdempotencyStore();
  await recordIdempotency(null, { status: 200, body: {}, completedAt: Date.now() }, { store });
  // No error, no state change — the store should still be empty.
  const fetched = await store.get("");
  assert.equal(fetched, null);
  store.destroy();
});
