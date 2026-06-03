// Guards the SSRF fix in src/tools/upload-asset/io.ts. assertPublicHttpUrl must reject
// non-http schemes, localhost, and hosts that resolve to private/loopback/link-local IPs.
// Tests use IP literals + localhost + bad schemes so they never hit the network (DNS).

import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateIp, assertPublicHttpUrl } from "../dist/tools/upload-asset/io.js";

test("isPrivateIp flags loopback/private/link-local/CGNAT (IPv4)", () => {
  for (const ip of ["0.0.0.0", "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255",
                     "192.168.1.1", "169.254.169.254", "100.64.0.1"]) {
    assert.equal(isPrivateIp(ip), true, `should flag ${ip}`);
  }
});

test("isPrivateIp allows public IPv4 (incl. near-miss ranges)", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "192.169.0.1"]) {
    assert.equal(isPrivateIp(ip), false, `should allow ${ip}`);
  }
});

test("isPrivateIp handles IPv6 loopback/ULA/link-local + IPv4-mapped", () => {
  for (const ip of ["::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateIp(ip), true, `should flag ${ip}`);
  }
  for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPrivateIp(ip), false, `should allow ${ip}`);
  }
});

test("assertPublicHttpUrl rejects non-http schemes", async () => {
  await assert.rejects(() => assertPublicHttpUrl("file:///etc/passwd"), /http\(s\)/);
  await assert.rejects(() => assertPublicHttpUrl("ftp://host/x"), /http\(s\)/);
});

test("assertPublicHttpUrl rejects localhost and private IP literals (no DNS)", async () => {
  await assert.rejects(() => assertPublicHttpUrl("http://localhost:8080/x"), /localhost/);
  await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1/x"), /private|loopback|link-local/);
  await assert.rejects(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/"), /private|loopback|link-local/);
  await assert.rejects(() => assertPublicHttpUrl("http://[::1]/x"), /private|loopback|link-local/);
});

test("assertPublicHttpUrl allows a public IP literal (no DNS) and rejects malformed URLs", async () => {
  await assert.doesNotReject(() => assertPublicHttpUrl("https://93.184.216.34/img.png"));
  await assert.rejects(() => assertPublicHttpUrl("not a url"), /Invalid URL/);
});
