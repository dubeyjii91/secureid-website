import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server/server.js", import.meta.url), "utf8");

test("session lifetime has both absolute and idle expiry boundaries", () => {
  assert.match(server, /const sessionTtlMs = 8 \* 60 \* 60 \* 1000/);
  assert.match(server, /const sessionIdleTtlMs = 2 \* 60 \* 60 \* 1000/);
  assert.match(server, /Number\(row\.expires_at\) <= Date\.now\(\)/);
  assert.match(server, /Date\.now\(\) - Number\(row\.last_seen_at\) > sessionIdleTtlMs/);
  assert.match(server, /DELETE FROM sessions WHERE token_hash = \?/);
  assert.match(server, /clearSessionCookie\(res\)/);
});

test("production authentication cookies remain host-only, secure, HttpOnly and SameSite strict", () => {
  assert.match(server, /const sessionCookieName = isProduction \? "__Host-secureid\.sid"/);
  assert.match(server, /const csrfCookieName = isProduction \? "__Host-secureid\.csrf"/);
  assert.match(server, /"HttpOnly", "SameSite=Strict"/);
  assert.match(server, /if \(isProduction\) parts\.push\("Secure"\)/);
  assert.match(server, /"Path=\/", `Max-Age=\$\{Math\.floor\(maxAgeMs \/ 1000\)\}`, "HttpOnly", "SameSite=Strict"/);
});

test("state-changing requests require matching CSRF cookie and header and production origin", () => {
  assert.match(server, /if \(isProduction && req\.get\("origin"\) !== appOrigin\)/);
  assert.match(server, /const cookieToken=getCookie\(req,csrfCookieName\)/);
  assert.match(server, /const headerToken=String\(req\.get\("X-CSRF-Token"\) \|\| ""\)/);
  assert.match(server, /cookieToken !== headerToken/);
  assert.match(server, /CSRF_VALIDATION_FAILED/);
});

test("production refuses console-only OTP delivery and non-HTTPS origins", () => {
  assert.match(server, /if \(isProduction && !\["resend", "smtp", "brevo"\]\.includes\(otpDelivery\)\)/);
  assert.match(server, /if \(isProduction && !appOrigin\.startsWith\("https:\/\/"\)\)/);
});
