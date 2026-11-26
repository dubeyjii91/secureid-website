import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const executeFile = promisify(execFile);
const MIME_EXTENSIONS = Object.freeze({
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
});
const MAX_OCR_BYTES = 10 * 1024 * 1024;
const MAX_OCR_CHARACTERS = 20_000;
const MAX_PDF_PAGES = 5;

function commandError(cause) {
  const error = new Error(
    cause?.code === "ETIMEDOUT"
      ? "Document text extraction took too long. Try a smaller or clearer file."
      : cause?.code === "ENOENT"
        ? "The SecureID OCR tools are not installed on this server."
        : "The document could not be processed by the SecureID OCR tools.",
  );
  error.code = cause?.code === "ETIMEDOUT"
    ? "OCR_TIMEOUT"
    : cause?.code === "ENOENT"
      ? "OCR_ENGINE_UNAVAILABLE"
      : "OCR_PROCESSING_FAILED";
  return error;
}

async function runCommand(execute, command, args, timeoutMs, maxBuffer = 128 * 1024) {
  try {
    return await execute(command, args, {
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
    });
  } catch (cause) {
    throw commandError(cause);
  }
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, MAX_OCR_CHARACTERS);
}

export async function extractDocumentText(
  buffer,
  mimeType,
  {
    execute = executeFile,
    tempDirectory = os.tmpdir(),
    timeoutMs = 30_000,
  } = {},
) {
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) {
    const error = new Error("OCR supports PDF, JPEG, PNG and WebP documents only.");
    error.code = "OCR_UNSUPPORTED_MEDIA";
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_OCR_BYTES) {
    const error = new Error("The document must contain between 1 byte and 10 MB of data.");
    error.code = "OCR_INVALID_IMAGE";
    throw error;
  }

  const workingDirectory = await fs.mkdtemp(path.join(tempDirectory, "secureid-ocr-"));
  try {
    await fs.chmod(workingDirectory, 0o700);
    const sourcePath = path.join(workingDirectory, `source${extension}`);
    await fs.writeFile(sourcePath, buffer, { mode: 0o600, flag: "wx" });

    if (mimeType === "application/pdf") {
      const info = await runCommand(execute, "pdfinfo", [sourcePath], timeoutMs);
      const pageMatch = String(info.stdout || "").match(/^Pages:\s*(\d+)\s*$/mi);
      const pagesTotal = pageMatch ? Number(pageMatch[1]) : 0;
      if (!Number.isInteger(pagesTotal) || pagesTotal < 1) {
        const error = new Error("The PDF did not contain any readable pages.");
        error.code = "OCR_INVALID_DOCUMENT";
        throw error;
      }

      const pagesToProcess = Math.min(pagesTotal, MAX_PDF_PAGES);
      const nativeText = await runCommand(
        execute,
        "pdftotext",
        ["-f", "1", "-l", String(pagesToProcess), "-layout", sourcePath, "-"],
        timeoutMs,
      );
      const extractedNativeText = cleanText(nativeText.stdout);
      if (extractedNativeText) {
        return {
          text: extractedNativeText,
          pagesProcessed: pagesToProcess,
          pagesTotal,
          pageLimit: MAX_PDF_PAGES,
          truncated: pagesTotal > MAX_PDF_PAGES,
          method: "pdf_text",
        };
      }

      const imagePrefix = path.join(workingDirectory, "page");
      await runCommand(
        execute,
        "pdftoppm",
        ["-f", "1", "-l", String(pagesToProcess), "-r", "150", "-png", sourcePath, imagePrefix],
        timeoutMs,
      );
      const pageFiles = (await fs.readdir(workingDirectory))
        .filter((name) => /^page-\d+\.png$/i.test(name))
        .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]))
        .slice(0, MAX_PDF_PAGES);

      if (!pageFiles.length) {
        const error = new Error("The PDF pages could not be rendered for OCR.");
        error.code = "OCR_INVALID_DOCUMENT";
        throw error;
      }

      const pageTexts = [];
      for (let index = 0; index < pageFiles.length; index += 1) {
        const pagePath = path.join(workingDirectory, pageFiles[index]);
        await fs.chmod(pagePath, 0o600);
        const result = await runCommand(
          execute,
          "tesseract",
          [pagePath, "stdout", "-l", "eng+hin", "--psm", "6"],
          timeoutMs,
        );
        const pageText = cleanText(result.stdout);
        if (pageText) pageTexts.push(`Page ${index + 1}\n${pageText}`);
      }

      return {
        text: cleanText(pageTexts.join("\n\n")),
        pagesProcessed: pageFiles.length,
        pagesTotal,
        pageLimit: MAX_PDF_PAGES,
        truncated: pagesTotal > MAX_PDF_PAGES,
        method: "pdf_ocr",
      };
    }

    const output = await runCommand(
      execute,
      "tesseract",
      [sourcePath, "stdout", "-l", "eng+hin", "--psm", "6"],
      timeoutMs,
    );
    return {
      text: cleanText(output.stdout),
      pagesProcessed: 1,
      pagesTotal: 1,
      pageLimit: 1,
      truncated: false,
      method: "image_ocr",
    };
  } finally {
    // The plaintext source document and every rendered page are removed on success and failure.
    await fs.rm(workingDirectory, { recursive: true, force: true });
  }
}

export const DOCUMENT_OCR_SUPPORTED_MIME_TYPES = Object.freeze(Object.keys(MIME_EXTENSIONS));
