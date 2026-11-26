import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const executeFile = promisify(execFile);
const MIME_EXTENSIONS = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
});
const MAX_OCR_BYTES = 10 * 1024 * 1024;
const MAX_OCR_CHARACTERS = 20_000;

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
    const error = new Error("OCR currently supports JPEG, PNG and WebP images only.");
    error.code = "OCR_UNSUPPORTED_MEDIA";
    throw error;
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_OCR_BYTES) {
    const error = new Error("The image must contain between 1 byte and 10 MB of data.");
    error.code = "OCR_INVALID_IMAGE";
    throw error;
  }

  const workingDirectory = await fs.mkdtemp(path.join(tempDirectory, "secureid-ocr-"));
  let imagePath = "";
  try {
    await fs.chmod(workingDirectory, 0o700);
    imagePath = path.join(workingDirectory, `source${extension}`);
    await fs.writeFile(imagePath, buffer, { mode: 0o600, flag: "wx" });

    let output;
    try {
      output = await execute(
        "tesseract",
        [imagePath, "stdout", "-l", "eng+hin", "--psm", "6"],
        {
          timeout: timeoutMs,
          maxBuffer: 128 * 1024,
          windowsHide: true,
        },
      );
    } catch (cause) {
      const error = new Error(
        cause?.code === "ETIMEDOUT"
          ? "Image text extraction took too long. Try a clearer or smaller image."
          : cause?.code === "ENOENT"
            ? "The SecureID OCR engine is not installed on this server."
            : "The image could not be processed by the OCR engine.",
      );
      error.code = cause?.code === "ETIMEDOUT"
        ? "OCR_TIMEOUT"
        : cause?.code === "ENOENT"
          ? "OCR_ENGINE_UNAVAILABLE"
          : "OCR_PROCESSING_FAILED";
      throw error;
    }

    return String(output?.stdout || "")
      .replace(/\\u0000/g, "")
      .trim()
      .slice(0, MAX_OCR_CHARACTERS);
  } finally {
    // The plaintext source image and any OCR scratch files never survive a request.
    await fs.rm(workingDirectory, { recursive: true, force: true });
  }
}

export const DOCUMENT_OCR_SUPPORTED_MIME_TYPES = Object.freeze(Object.keys(MIME_EXTENSIONS));
