import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../mobile/src/api.ts", import.meta.url), "utf8");
const vault = await readFile(new URL("../mobile/app/vault.tsx", import.meta.url), "utf8");

function functionBlock(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `function not found: ${signature}`);
  const end = source.indexOf(nextSignature, start + signature.length);
  assert.notEqual(end, -1, `next function not found: ${nextSignature}`);
  return source.slice(start, end);
}

test("local OCR cache cleanup only targets SecureID OCR temporary files", () => {
  const cleanup = functionBlock(api, "export async function cleanupLocalOcrCache()", "export async function downloadDocumentForLocalOcr");
  assert.match(cleanup, /FileSystem\.cacheDirectory/);
  assert.match(cleanup, /readDirectoryAsync/);
  assert.match(cleanup, /entry\.startsWith\("secureid-local-ocr-"\)/);
  assert.match(cleanup, /FileSystem\.deleteAsync/);
  assert.match(cleanup, /catch\s*\{\s*\}/);
});

test("OCR downloads remove partial files when the transfer fails", () => {
  const download = functionBlock(api, "export async function downloadDocumentForLocalOcr", "export async function downloadDocument(");
  assert.match(download, /const destination = `\$\{FileSystem\.cacheDirectory\}secureid-local-ocr-/);
  assert.match(download, /catch \(error\)[\s\S]*?deleteAsync\(destination/);
  assert.match(download, /result\.status !== 200[\s\S]*?deleteAsync\(result\.uri/);
  assert.match(download, /Authorization: `Bearer \$\{token\}`/);
});

test("OCR plaintext is deleted after success and every processing failure", () => {
  const ocr = functionBlock(vault, "async function runLocalOcr(", "function confirmLocalOcr(");
  assert.match(ocr, /temporaryUri = await downloadDocumentForLocalOcr/);
  assert.match(ocr, /recognizeText\(\{ uri: temporaryUri \}/);
  assert.match(ocr, /finally\s*\{[\s\S]*?FileSystem\.deleteAsync\(temporaryUri/);
  assert.match(ocr, /setOcrPreview\(\{[\s\S]*?result\.text/);
});

test("OCR is opt-in, image-only, and does not save extracted text to the profile", () => {
  const confirm = functionBlock(vault, "function confirmLocalOcr(", "async function openDocument(");
  assert.match(confirm, /document\.mimeType\.startsWith\("image\/"\)/);
  assert.match(confirm, /Alert\.alert\([\s\S]*?Continue/);
  assert.match(confirm, /PDF OCR is not enabled yet/);
  assert.match(vault, /Extracted text preview/);
  assert.doesNotMatch(vault, /saveIdentityProfile\s*\(/);
  assert.doesNotMatch(vault, /updateDocumentExpiry\([^\n]*ocrPreview/);
});
