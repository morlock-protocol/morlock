// Tests for validateParamsAgainst — the single source of truth for param
// validation. Covers every branch of the new schema features from Batch 2.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateParamsAgainst } from "../src/server/index";
import type { ParamSchema } from "../src/shared/types";

function def(params: Record<string, ParamSchema>) {
  return { params };
}

test("returns null when no params are declared", () => {
  assert.equal(validateParamsAgainst({ anything: 1 }, {}), null);
});

test("required param missing → error mentions key", () => {
  const err = validateParamsAgainst({}, def({ q: { type: "string", required: true } }));
  assert.match(err!, /Missing required param/);
  assert.match(err!, /"q"/);
});

test("required param is null → treated as missing", () => {
  const err = validateParamsAgainst({ q: null }, def({ q: { type: "string", required: true } }));
  assert.match(err!, /Missing required param/);
});

test("null does NOT pass the object type check", () => {
  // This was the v0.2.1 bug: typeof null === 'object' would silently validate.
  // After the refactor, null is treated as missing, so a non-required null is
  // allowed and skipped rather than running the type check.
  const err = validateParamsAgainst({ body: null }, def({ body: { type: "object" } }));
  assert.equal(err, null);
});

test("required object with null → error", () => {
  const err = validateParamsAgainst({ body: null }, def({ body: { type: "object", required: true } }));
  assert.match(err!, /Missing required/);
});

test("type mismatch surfaces actual type", () => {
  const err = validateParamsAgainst({ q: 42 }, def({ q: { type: "string" } }));
  assert.match(err!, /should be string, got number/);
});

test("arrays are detected over typeof 'object'", () => {
  const ok = validateParamsAgainst({ xs: [1, 2, 3] }, def({ xs: { type: "array" } }));
  assert.equal(ok, null);

  const mismatched = validateParamsAgainst({ xs: [1, 2, 3] }, def({ xs: { type: "object" } }));
  assert.match(mismatched!, /should be object, got array/);
});

test("enum matches on stringified value", () => {
  const ok = validateParamsAgainst({ n: 2 }, def({ n: { type: "number", enum: ["1", "2", "3"] } }));
  assert.equal(ok, null);

  const bad = validateParamsAgainst({ n: 4 }, def({ n: { type: "number", enum: ["1", "2", "3"] } }));
  assert.match(bad!, /must be one of/);
});

test("string minLength / maxLength", () => {
  const schema: Record<string, ParamSchema> = { q: { type: "string", minLength: 3, maxLength: 5 } };
  assert.match(validateParamsAgainst({ q: "ab" }, def(schema))!, /at least 3/);
  assert.match(validateParamsAgainst({ q: "abcdef" }, def(schema))!, /at most 5/);
  assert.equal(validateParamsAgainst({ q: "abcd" }, def(schema)), null);
});

test("string pattern — match and mismatch", () => {
  const schema: Record<string, ParamSchema> = {
    slug: { type: "string", pattern: "^[a-z0-9-]+$" },
  };
  assert.equal(validateParamsAgainst({ slug: "my-post" }, def(schema)), null);
  assert.match(validateParamsAgainst({ slug: "My Post!" }, def(schema))!, /does not match/);
});

test("invalid pattern on the schema → server-side error", () => {
  const schema: Record<string, ParamSchema> = {
    slug: { type: "string", pattern: "(unterminated" },
  };
  assert.match(validateParamsAgainst({ slug: "x" }, def(schema))!, /invalid pattern/);
});

test("number min / max — inclusive", () => {
  const schema: Record<string, ParamSchema> = { n: { type: "number", min: 0, max: 10 } };
  assert.match(validateParamsAgainst({ n: -1 }, def(schema))!, />= 0/);
  assert.match(validateParamsAgainst({ n: 11 }, def(schema))!, /<= 10/);
  assert.equal(validateParamsAgainst({ n: 0 }, def(schema)), null);
  assert.equal(validateParamsAgainst({ n: 10 }, def(schema)), null);
});

test("number NaN / Infinity rejected", () => {
  const schema: Record<string, ParamSchema> = { n: { type: "number" } };
  assert.match(validateParamsAgainst({ n: NaN }, def(schema))!, /finite/);
  assert.match(validateParamsAgainst({ n: Infinity }, def(schema))!, /finite/);
});

test("array maxItems", () => {
  const schema: Record<string, ParamSchema> = { xs: { type: "array", maxItems: 2 } };
  assert.match(validateParamsAgainst({ xs: [1, 2, 3] }, def(schema))!, /at most 2 items/);
  assert.equal(validateParamsAgainst({ xs: [1, 2] }, def(schema)), null);
});

test("unspecified params are ignored", () => {
  const err = validateParamsAgainst(
    { declared: "x", extra: "ignored" },
    def({ declared: { type: "string" } })
  );
  assert.equal(err, null);
});

test("first error wins — stops at first failing key", () => {
  const schema: Record<string, ParamSchema> = {
    a: { type: "string", required: true },
    b: { type: "number", required: true },
  };
  const err = validateParamsAgainst({}, def(schema));
  assert.match(err!, /"a"/);
  assert.doesNotMatch(err!, /"b"/);
});
