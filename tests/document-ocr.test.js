import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  extractDocumentText,
  DOCUMENT_OCR_SUPPORTED_MIME_TYPES,
} from "../server/document-ocr.js";

test("image OCR uses English and Hindi models and cleans temporary plaintext", async () => {
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
    assert.equal(extracted.text, "Name: Sample User\nEmail: sample@example.test");
    assert.equal(extracted.method, "image_ocr");
    assert.equal(extracted.pagesProcessed, 1);
    assert.ok(observedPath);
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("text-based PDFs extract only the first five pages and report truncation", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "secureid-ocr-test-"));
  try {
    const extracted = await extractDocumentText(Buffer.from("%PDF synthetic"), "application/pdf", {
      tempDirectory: parent,
      execute: async (command, args) => {
        if (command === "pdfinfo") return { stdout: "Pages:          8\n" };
        if (command === "pdftotext") {
          assert.equal(args[0], "-f");
          assert.equal(args[1], "1");
          assert.equal(args[2], "-l");
          assert.equal(args[3], "5");
          assert.equal(args[4], "-layout");
          return { stdout: "Applicant: Sample User\n" };
        }
        throw new Error("Unexpected external process");
      },
    });
    assert.equal(extracted.text, "Applicant: Sample User");
    assert.equal(extracted.method, "pdf_text");
    assert.equal(extracted.pagesTotal, 8);
    assert.equal(extracted.pagesProcessed, 5);
    assert.equal(extracted.truncated, true);
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("scanned PDFs render a bounded number of pages, OCR them and delete rendered files", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "secureid-ocr-test-"));
  try {
    const extracted = await extractDocumentText(Buffer.from("%PDF synthetic scanned"), "application/pdf", {
      tempDirectory: parent,
      execute: async (command, args) => {
        if (command === "pdfinfo") return { stdout: "Pages: 2\n" };
        if (command === "pdftotext") return { stdout: "\f\n" };
        if (command === "pdftoppm") {
          const prefix = args.at(-1);
          await writeFile(prefix + "-1.png", "rendered-page-one");
          await writeFile(prefix + "-2.png", "rendered-page-two");
          return { stdout: "" };
        }
        if (command === "tesseract") {
          const image = await readFile(args[0], "utf8");
          return { stdout: image.includes("one") ? "Name: Sample User" : "Email: sample@example.test" };
        }
        throw new Error("Unexpected external process");
      },
    });
    assert.equal(extracted.method, "pdf_ocr");
    assert.equal(extracted.pagesTotal, 2);
    assert.equal(extracted.pagesProcessed, 2);
    assert.equal(extracted.truncated, false);
    assert.match(extracted.text, /Page 1\nName: Sample User/);
    assert.match(extracted.text, /Page 2\nEmail: sample@example\.test/);
    assert.deepEqual(await readdir(parent), []);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("OCR rejects unsupported formats and oversized files before creating plaintext", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "secureid-ocr-test-"));
  try {
    await assert.rejects(
      extractDocumentText(Buffer.from("gif"), "image/gif", { tempDirectory: parent }),
      (error) => error.code === "OCR_UNSUPPORTED_MEDIA",
    );
    await assert.rejects(
      extractDocumentText(Buffer.alloc(10 * 1024 * 1024 + 1), "image/jpeg", { tempDirectory: parent }),
      (error) => error.code === "OCR_INVALID_IMAGE",
    );
    assert.deepEqual(await readdir(parent), []);
    assert.deepEqual(DOCUMENT_OCR_SUPPORTED_MIME_TYPES, ["application/pdf", "image/jpeg", "image/png", "image/webp"]);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("OCR removes temporary plaintext and rendered files when a process fails", async () => {
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
