import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../mobile/src/api.ts", import.meta.url), "utf8");
const login = await readFile(new URL("../mobile/app/login.tsx", import.meta.url), "utf8");
const register = await readFile(new URL("../mobile/app/register.tsx", import.meta.url), "utf8");
const forgot = await readFile(new URL("../mobile/app/forgot-password.tsx", import.meta.url), "utf8");

test("native registration uses the server registration endpoint with CSRF bootstrap", () => {
  assert.match(api, /async function unauthenticatedPost/);
  assert.match(api, /X-CSRF-Token/);
  assert.match(api, /const cookieName = "__Host-secureid\\.csrf"/);
  assert.match(api, /Cookie: `\\$\\{cookieName\\}=/);
  assert.match(api, /registerAccount\(email: string, password: string\)/);
  assert.match(api, /"\/api\/auth\/register"/);
});

test("native registration validates password confirmation and waits for email verification", () => {
  assert.match(register, /password !== confirmPassword/);
  assert.match(register, /12 and 72 bytes/);
  assert.match(register, /[Vv]erify your email before signing in/);
  assert.match(register, /router\.replace\("\/login"\)/);
});

test("native forgot-password flow uses the generic non-enumerating response", () => {
  assert.match(api, /requestPasswordReset\(email: string\)/);
  assert.match(api, /"\/api\/auth\/forgot-password"/);
  assert.match(forgot, /If an account exists/);
  assert.match(forgot, /same confirmation whether or not the email address is registered/);
});

test("native sign-in exposes account creation and password recovery entry points", () => {
  assert.match(login, /router\.push\("\/register"\)/);
  assert.match(login, /router\.push\("\/forgot-password"\)/);
});
