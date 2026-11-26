import test from "node:test";
import assert from "node:assert/strict";
import { parseOcrCandidates } from "../src/smartfill-ocr.js";

test("SmartFill OCR parser extracts clearly labelled identity candidates for review", () => {
  const text = [
    "Name: Asha Kumari",
    "DOB: 07/11/2004",
    "Email: asha.kumari@example.test",
    "Mobile: 9876543210",
    "Aadhaar: 1234 5678 9012",
    "PAN: ABCDE1234F",
    "Student ID: STU-2026-17",
    "Address: 12 Main Road, Patna",
  ].join("\n");
  assert.deepEqual(parseOcrCandidates(text), {
    "contact.email": "asha.kumari@example.test",
    "identity.pan": "ABCDE1234F",
    "identity.aadhaar": "123456789012",
    "contact.phone": "9876543210",
    "personal.date_of_birth": "2004-11-07",
    "personal.full_name": "Asha Kumari",
    "education.roll_number": "STU-2026-17",
    "address.full": "12 Main Road, Patna",
  });
});

test("SmartFill OCR parser does not invent unlabelled Aadhaar or invalid dates", () => {
  const candidates = parseOcrCandidates("DOB: 31/02/2004\nID: 123456789012\nContact: 9123456789");
  assert.equal(candidates["personal.date_of_birth"], undefined);
  assert.equal(candidates["identity.aadhaar"], undefined);
  assert.equal(candidates["contact.phone"], "9123456789");
});

test("SmartFill OCR parser bounds and strips candidate text", () => {
  const candidates = parseOcrCandidates("Name: " + "A".repeat(600) + "\nEmail: short@example.test");
  assert.equal(candidates["personal.full_name"], undefined);
  assert.equal(candidates["contact.email"], "short@example.test");
});
