import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testPattern = /\.test\.(?:js|cjs|mjs)$/i;

function collectTestFiles(directory) {
  const absoluteDirectory = path.join(root, directory);
  const files = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && testPattern.test(entry.name)) files.push(fullPath);
    }
  }
  try {
    walk(absoluteDirectory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return files;
}

const testFiles = [
  ...collectTestFiles("test"),
  ...collectTestFiles("tests"),
  ...readdirSync(path.join(root, "server"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^test-.*\.(?:js|cjs|mjs)$/i.test(entry.name))
    .map((entry) => path.join(root, "server", entry.name)),
].sort();

if (testFiles.length === 0) {
  console.error("No SecureID test files were found in test/, tests/, or server/test-*.");
  process.exit(1);
}

console.log(`Running ${testFiles.length} repository test files; nested repository copies are excluded.\n`);
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
