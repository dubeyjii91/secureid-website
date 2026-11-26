import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  extractDocumentText,
  DOCUMENT_OCR_SUPPORTED_MIME_TYPES,
} from "../server/document-ocr.js";

test("document OCR supports only raster images and cleans its plaintext working directory", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "secureid-ocr-test-"));
  try {
    const source = Buffer.from("synthetic image fixture");
    let observedPath = "";
    const extracted = await extractDocumentText(source, "image/png", {
      tempDirectory: parent,
      execute: async (command, args, options) => {
        assert.equal(command, "tesseract");
        assert.deepEqual(args.slice(1), ["stdout", "-l", "eng+hin", "--psm", "6"]);
        assert.equal(options.timeout, 30_000);
        assert.equal(options.maxBuffer, 128 * 1024);
        observedPath = args[0];
        assert.equal(await readFile(observedPath, "utf8"), source.toString());
        return { stdout: "Name: Sample User\nEmail: sample@example.test\n" };
      },
    });
    assert.equal(extracted, "Name: Sample User\nEmail: sample@example.test");
    assert.ok(observedPath);
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("document OCR rejects unsupported formats and oversized files before creating plaintext", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "secureid-ocr-test-"));
  try {
    await assert.rejects(
      extractDocumentText(Buffer.from("pdf"), "application/pdf", { tempDirectory: parent }),
      (error) => error.code === "OCR_UNSUPPORTED_MEDIA",
    );
    await assert.rejects(
      extractDocumentText(Buffer.alloc(10 * 1024 * 1024 + 1), "image/jpeg", { tempDirectory: parent }),
      (error) => error.code === "OCR_INVALID_IMAGE",
    );
    assert.deepEqual(await readdir(parent), []);
    assert.deepEqual(DOCUMENT_OCR_SUPPORTED_MIME_TYPES, ["image/jpeg", "image/png", "image/webp"]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("document OCR removes temporary plaintext when the OCR process fails", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "secureid-ocr-test-"));
  try {
    await assert.rejects(
      extractDocumentText(Buffer.from("image bytes"), "image/jpeg", {
        tempDirectory: parent,
        execute: async () => {
          throw Object.assign(new Error("internal process details"), { code: "ETIMEDOUT" });
        },
      }),
      (error) => error.code === "OCR_TIMEOUT" && !error.message.includes("internal process details"),
    );
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
