import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectories = ["test", "tests"];
const testPattern = /\.test\.(?:js|cjs|mjs)$/;
const testFiles = testDirectories.flatMap((directory) => {
  const absoluteDirectory = path.join(root, directory);
  try {
    return readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && testPattern.test(entry.name))
      .map((entry) => path.join(absoluteDirectory, entry.name));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}).sort();

if (testFiles.length === 0) {
  console.error("No root-level SecureID test files were found in test/ or tests/.");
  process.exit(1);
}

console.log(`Running ${testFiles.length} root-level SecureID test files (nested copies are intentionally excluded).\n`);
const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
