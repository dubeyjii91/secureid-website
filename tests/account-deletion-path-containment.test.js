import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server/server.js", import.meta.url), "utf8");

test("account deletion confines document file deletion to the storage directory", () => {
  assert.match(server, /const root=path\.resolve\(storagePath\)/);
  assert.match(server, /path\.relative\(root,path\.resolve\(p\)\)/);
  assert.match(server, /relative!==""/);
  assert.match(server, /relative!=="\.\."/);
  assert.match(server, /!relative\.startsWith\(\x60\.\.\$\{path\.sep\}\x60\)/);
  assert.match(server, /!path\.isAbsolute\(relative\)/);
  assert.match(server, /if\(p && isInsideStorage\) try\{unlinkSync\(path\.resolve\(p\)\);?\}/);
});
