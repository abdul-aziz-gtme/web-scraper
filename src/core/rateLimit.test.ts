// Network-free tests for the in-memory rate limiter.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, clientIpFrom } from "./rateLimit.js";

test("allows up to the limit then blocks within the window", () => {
  const ip = "test-1";
  const t0 = 1_000_000;
  let lastOk = true;
  for (let i = 0; i < 40; i++) {
    lastOk = checkRateLimit(ip, t0 + i, { windowMs: 60_000, max: 40 }).ok;
    assert.ok(lastOk, `request ${i} should be allowed`);
  }
  const over = checkRateLimit(ip, t0 + 41, { windowMs: 60_000, max: 40 });
  assert.equal(over.ok, false);
  assert.ok(over.retryAfterSec >= 1);
});

test("window slides — old hits expire", () => {
  const ip = "test-2";
  for (let i = 0; i < 5; i++) {
    assert.ok(checkRateLimit(ip, 2_000_000 + i, { windowMs: 1000, max: 5 }).ok);
  }
  assert.equal(checkRateLimit(ip, 2_000_010, { windowMs: 1000, max: 5 }).ok, false);
  // Far in the future, the bucket has drained.
  assert.ok(checkRateLimit(ip, 2_100_000, { windowMs: 1000, max: 5 }).ok);
});

test("clientIpFrom prefers x-forwarded-for first hop", () => {
  const headers: Record<string, string | null> = {
    "x-forwarded-for": "203.0.113.7, 70.0.0.1",
    "x-real-ip": "9.9.9.9",
  };
  assert.equal(clientIpFrom((n) => headers[n] ?? null), "203.0.113.7");
  assert.equal(clientIpFrom((n) => (n === "x-real-ip" ? "9.9.9.9" : null)), "9.9.9.9");
  assert.equal(clientIpFrom(() => null), "unknown");
});
