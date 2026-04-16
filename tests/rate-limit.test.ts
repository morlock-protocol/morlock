import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryRateLimiterStore,
  resolveClientIp,
  checkRateLimit,
} from "../src/server/rate-limit";

test("resolveClientIp: trustedProxyCount=0 ignores XFF entirely", () => {
  // Even if XFF is set, a trustedProxyCount of 0 means we must use the socket IP.
  // This is the spec-mandated default and protects against spoofing.
  assert.equal(resolveClientIp("1.2.3.4", "99.99.99.99", 0), "1.2.3.4");
  assert.equal(resolveClientIp("1.2.3.4", undefined, 0), "1.2.3.4");
  assert.equal(resolveClientIp(undefined, "99.99.99.99", 0), "unknown");
});

test("resolveClientIp: trustedProxyCount=1 uses second-from-right XFF entry", () => {
  // Proxy chain: [client, our-proxy] → trust 1 hop → use client IP.
  assert.equal(
    resolveClientIp("proxy-ip", "203.0.113.1, 10.0.0.1", 1),
    "203.0.113.1"
  );
});

test("resolveClientIp: trustedProxyCount=2", () => {
  // [client, proxy1, proxy2] → trust 2 hops → use client IP (leftmost).
  assert.equal(
    resolveClientIp("proxy2-ip", "203.0.113.1, 10.0.0.1, 10.0.0.2", 2),
    "203.0.113.1"
  );
});

test("resolveClientIp: trustedProxyCount larger than XFF entries falls back", () => {
  // Would index out of bounds → fall back to socketIp rather than invent data.
  assert.equal(resolveClientIp("1.2.3.4", "only-one", 5), "1.2.3.4");
});

test("resolveClientIp: missing socket and missing XFF → 'unknown'", () => {
  assert.equal(resolveClientIp(undefined, undefined, 0), "unknown");
});

test("InMemoryRateLimiterStore: fresh bucket returns count=1 with windowed reset", async () => {
  const store = new InMemoryRateLimiterStore();
  const before = Date.now();
  const res = await store.increment("k", 1000);
  const after = Date.now();

  assert.equal(res.count, 1);
  assert.ok(res.resetAt >= before + 1000);
  assert.ok(res.resetAt <= after + 1000);
  store.destroy();
});

test("InMemoryRateLimiterStore: repeat increments share the bucket's resetAt", async () => {
  const store = new InMemoryRateLimiterStore();
  const r1 = await store.increment("k", 1000);
  const r2 = await store.increment("k", 1000);
  const r3 = await store.increment("k", 1000);

  assert.equal(r1.count, 1);
  assert.equal(r2.count, 2);
  assert.equal(r3.count, 3);
  // All three calls are in the same bucket → same reset time.
  assert.equal(r1.resetAt, r2.resetAt);
  assert.equal(r2.resetAt, r3.resetAt);
  store.destroy();
});

test("InMemoryRateLimiterStore: expired bucket creates a new one", async () => {
  const store = new InMemoryRateLimiterStore();
  const r1 = await store.increment("k", 1);  // 1ms window
  await new Promise((r) => setTimeout(r, 5));
  const r2 = await store.increment("k", 1);

  assert.equal(r1.count, 1);
  assert.equal(r2.count, 1); // fresh bucket
  assert.notEqual(r1.resetAt, r2.resetAt);
  store.destroy();
});

test("checkRateLimit: below threshold → allowed, remaining decreases", async () => {
  const store = new InMemoryRateLimiterStore();
  const r1 = await checkRateLimit("1.1.1.1", undefined, { maxRequests: 3, windowMs: 60_000, store });
  const r2 = await checkRateLimit("1.1.1.1", undefined, { maxRequests: 3, windowMs: 60_000, store });
  const r3 = await checkRateLimit("1.1.1.1", undefined, { maxRequests: 3, windowMs: 60_000, store });

  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);
  assert.equal(r2.remaining, 1);
  assert.equal(r3.remaining, 0);
  store.destroy();
});

test("checkRateLimit: exceeds threshold → denied", async () => {
  const store = new InMemoryRateLimiterStore();
  const opts = { maxRequests: 2, windowMs: 60_000, store };
  await checkRateLimit("2.2.2.2", undefined, opts);
  await checkRateLimit("2.2.2.2", undefined, opts);
  const r3 = await checkRateLimit("2.2.2.2", undefined, opts);

  assert.equal(r3.allowed, false);
  // remaining is clamped at 0 — never negative.
  assert.equal(r3.remaining, 0);
  store.destroy();
});

test("checkRateLimit: different IPs → different buckets", async () => {
  const store = new InMemoryRateLimiterStore();
  const opts = { maxRequests: 1, windowMs: 60_000, store };
  const a = await checkRateLimit("a", undefined, opts);
  const b = await checkRateLimit("b", undefined, opts);

  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
  store.destroy();
});

test("checkRateLimit: resolvedIp reflects trustedProxyCount", async () => {
  const store = new InMemoryRateLimiterStore();
  const res = await checkRateLimit("proxy-ip", "203.0.113.1, 10.0.0.1", {
    maxRequests: 10,
    windowMs: 60_000,
    trustedProxyCount: 1,
    store,
  });
  assert.equal(res.resolvedIp, "203.0.113.1");
  store.destroy();
});
