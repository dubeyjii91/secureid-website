import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../mobile/src/api.ts", import.meta.url), "utf8");
const security = await readFile(new URL("../mobile/app/security.tsx", import.meta.url), "utf8");
const biometric = await readFile(new URL("../mobile/src/biometric.ts", import.meta.url), "utf8");
const deletionPage = await readFile(new URL("../public/delete-account.html", import.meta.url), "utf8");

test("native account deletion calls the authenticated server endpoint", () => {
  assert.match(api, /export async function deleteAccount\(password: string\)/);
  assert.match(api, /"\/api\/account"/);
  assert.match(api, /method: "DELETE"/);
  assert.match(api, /deleteItemAsync\(TOKEN_KEY\)/);
});

test("native account deletion requires password confirmation", () => {
  assert.match(security, /Account deletion/);
  assert.match(security, /secureTextEntry/);
  assert.match(security, /confirmDeleteAccount/);
  assert.match(security, /Permanently delete account\?/);
  assert.match(security, /clearBiometricLock/);
});

test("account deletion clears the local biometric preference", () => {
  assert.match(biometric, /clearBiometricLock/);
  assert.match(biometric, /deleteItemAsync\(BIOMETRIC_LOCK_KEY\)/);
});

test("public deletion instructions describe both app and website request paths", () => {
  assert.match(deletionPage, /Delete from the Android app/);
  assert.match(deletionPage, /Request deletion from the website/);
  assert.match(deletionPage, /Open SecureID sign in/);
});
