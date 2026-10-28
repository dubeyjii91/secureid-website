import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");

test("OTP verification has a bounded per-IP and per-user attempt limit", () => {
  assert.match(server, /createRateLimit\("otp-verify-ip",\s*5,\s*window15m,\s*getClientKey\)/);
  assert.match(server, /createRateLimit\("otp-verify-user",\s*5,\s*window15m,\s*\(req\)\s*=>\s*req\.user\?\.id\s*\|\|\s*getClientKey\(req\)\)/);
});

test("security notification email supports Brevo delivery", () => {
  assert.match(server, /\["resend",\s*"smtp",\s*"brevo"\]/);
});
