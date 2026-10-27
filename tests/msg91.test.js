import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMsg91Phone } from "../server/msg91.js";

test("normalizes Indian ten-digit phone numbers to country-code format", () => {
  assert.equal(normalizeMsg91Phone("9876543210"), "919876543210");
  assert.equal(normalizeMsg91Phone("+91 98765-43210"), "919876543210");
});

test("accepts international numbers with a country code", () => {
  assert.equal(normalizeMsg91Phone("+1 (415) 555-2671"), "14155552671");
});

test("rejects malformed or implausible phone numbers", () => {
  for (const value of ["", "12345", "abcdefghij", "0".repeat(10), "91 123", "+91 98765 43210 ext 2", "9".repeat(33)]) {
    assert.equal(normalizeMsg91Phone(value), null, String(value));
  }
});
