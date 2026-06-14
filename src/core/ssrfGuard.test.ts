// Network-free tests for the SSRF guard. These lock in that internal/private
// targets are rejected and ordinary public domains pass.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicUrl,
  assertPublicHost,
  SsrfError,
  parseLooseIPv4,
  isPrivateIPv4,
  parseIPv6,
  isPrivateIPv6,
} from "./ssrfGuard.js";

function blocked(url: string): boolean {
  try {
    assertPublicUrl(url);
    return false;
  } catch (e) {
    return e instanceof SsrfError;
  }
}

test("blocks loopback / localhost in many forms", () => {
  assert.ok(blocked("http://127.0.0.1/"));
  assert.ok(blocked("http://localhost/"));
  assert.ok(blocked("https://localhost:8080/admin"));
  assert.ok(blocked("http://127.1/")); // short form -> 127.0.0.1
  assert.ok(blocked("http://[::1]/"));
});

test("blocks RFC1918 / CGNAT private ranges", () => {
  assert.ok(blocked("http://10.0.0.5/"));
  assert.ok(blocked("http://192.168.1.1/"));
  assert.ok(blocked("http://172.16.0.1/"));
  assert.ok(blocked("http://172.31.255.255/"));
  assert.ok(blocked("http://100.64.0.1/"));
});

test("blocks link-local / cloud metadata 169.254.169.254", () => {
  assert.ok(blocked("http://169.254.169.254/latest/meta-data/"));
  assert.ok(blocked("http://169.254.0.1/"));
});

test("blocks decimal / octal / hex encodings of 127.0.0.1", () => {
  assert.ok(blocked("http://2130706433/")); // decimal
  assert.ok(blocked("http://0x7f000001/")); // hex
  assert.ok(blocked("http://0177.0.0.1/")); // octal
  assert.ok(blocked("http://0x7f.0.0.1/"));
});

test("blocks IPv6 private/link-local/ULA and IPv4-mapped", () => {
  assert.ok(blocked("http://[fe80::1]/"));
  assert.ok(blocked("http://[fc00::1]/"));
  assert.ok(blocked("http://[::ffff:127.0.0.1]/"));
  assert.ok(blocked("http://[::ffff:10.0.0.1]/"));
});

test("blocks non-http(s) protocols and embedded credentials", () => {
  assert.ok(blocked("file:///etc/passwd"));
  assert.ok(blocked("ftp://example.com/"));
  assert.ok(blocked("gopher://example.com/"));
  assert.ok(blocked("http://user:pass@example.com/"));
});

test("blocks internal suffixes and single-label hosts", () => {
  assert.ok(blocked("http://intranet/"));
  assert.ok(blocked("http://server.local/"));
  assert.ok(blocked("http://db.internal/"));
  assert.ok(blocked("http://wiki.corp/"));
});

test("allows ordinary public domains", () => {
  assert.doesNotThrow(() => assertPublicUrl("https://hubspot.com/"));
  assert.doesNotThrow(() => assertPublicUrl("https://www.shopify.com/path?q=1"));
  assert.doesNotThrow(() => assertPublicUrl("http://example.co.uk/"));
  // A public IP literal is allowed (8.8.8.8).
  assert.doesNotThrow(() => assertPublicHost("8.8.8.8"));
});

test("low-level helpers behave", () => {
  assert.equal(parseLooseIPv4("127.0.0.1"), 0x7f000001);
  assert.equal(parseLooseIPv4("2130706433"), 0x7f000001);
  assert.equal(parseLooseIPv4("notanip"), null);
  assert.ok(isPrivateIPv4(parseLooseIPv4("10.1.2.3")!));
  assert.ok(!isPrivateIPv4(parseLooseIPv4("8.8.8.8")!));
  assert.ok(isPrivateIPv6(parseIPv6("::1")!));
  assert.ok(!isPrivateIPv6(parseIPv6("2606:4700:4700::1111")!)); // Cloudflare DNS
});
